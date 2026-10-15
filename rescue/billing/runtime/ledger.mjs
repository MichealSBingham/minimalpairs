import { DurableObject } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hasLifetimeAccess, subscriptionEntitlement, BILLING_SCHEMA, BillingError, SUPPORTED_EVENTS, createBillingHandler, processQueuedEvent, reconcileBoundCustomer, sameCheckoutParameters } from '../core.mjs';
import { billingConfig, unavailable } from './config.mjs';

const uid = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const customer = value => typeof value === 'string' && /^cus_[A-Za-z0-9]+$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const errorCode = error => /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || '') ? error.code : 'processing_failed';
const fail = (code, status = 409) => { throw new BillingError(code, status); };
export const RETRY_BASE_MS = 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
export const WORKFLOW_TIMEOUT_MS = 25_000;
export const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RECONCILIATION_INITIAL_DELAY_MS = 60_000;
export const ALARM_BATCH_SIZE = 5;
export function retryDelay(attempts) { return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(20, Math.max(0, attempts - 1))); }

/**
 * Private SQLite ledger. Public requests can only reach fetch()/the core router.
 * A subclass supplies real provider ports; the production subclass has no test
 * behavior or debug routes. One object serializes the small initial account.
 */
export class BillingLedgerBase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.config = billingConfig(env);
    this.operationContexts = new AsyncLocalStorage();
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        uid TEXT PRIMARY KEY, customer_id TEXT UNIQUE,
        reservation_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkout_reservations (
        uid TEXT PRIMARY KEY, session_id TEXT, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_offers (uid TEXT PRIMARY KEY, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing_events (
        event_id TEXT PRIMARY KEY, envelope_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processed')),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL, processed_at INTEGER, last_error TEXT, ignored INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS billing_events_due ON billing_events(status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS customer_reconciliation (
        uid TEXT PRIMARY KEY REFERENCES customers(uid), next_attempt_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, last_success_at INTEGER, last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS customer_reconciliation_due ON customer_reconciliation(next_attempt_at, uid);
      CREATE TABLE IF NOT EXISTS billing_alarm_state (
        id INTEGER PRIMARY KEY CHECK(id = 1), next_kind TEXT NOT NULL CHECK(next_kind IN ('event','customer'))
      );
      INSERT INTO billing_alarm_state(id, next_kind) VALUES(1, 'event') ON CONFLICT(id) DO NOTHING;
    `);
    // Upgrade existing bindings once. Never reset retry/due state on restart.
    this.sql.exec(`INSERT INTO customer_reconciliation(uid, next_attempt_at)
      SELECT uid, ? FROM customers WHERE customer_id IS NOT NULL ON CONFLICT(uid) DO NOTHING`,
    this.now() + RECONCILIATION_INITIAL_DELAY_MS);
    // A pending queue survives eviction or deployment. Re-arming never changes
    // attempts or drops records. Disabled deployments do not run provider work.
    this.ctx.blockConcurrencyWhile(async () => {
      if (this.config.serviceEnabled) await this.scheduleNextAlarm();
    });
  }

  now() { return Date.now(); }
  workflowTimeoutMs() { return WORKFLOW_TIMEOUT_MS; }
  getOperationContext() { return this.operationContexts.getStore() ?? null; }
  enabled() { if (this.config.serviceEnabled !== true) fail('billing_not_enabled', 503); }
  createExternalPorts() { fail('billing_providers_not_configured', 503); }
  get ports() {
    if (!this._ports) this._ports = { ...this.createExternalPorts(), billing: this };
    return this._ports;
  }

  async fetch(request) {
    try {
      this.enabled();
      const internalPath=new URL(request.url).pathname;
      if(['/internal/recovery-offers','/internal/recovery-eligible'].includes(internalPath)) {
        if(!this.env.PURCHASE_FEED_TOKEN || request.headers.get('Authorization') !== 'Bearer '+this.env.PURCHASE_FEED_TOKEN)return new Response(null,{status:401});
        if(request.method !== 'GET')return new Response(null,{status:405});
        return await this.exclusive(async()=>{
          const now=Math.floor(this.now()/1000);
          if(!this.config.recoveryCouponId)return Response.json(internalPath.endsWith('eligible')?{eligible:false}:{data:[]});
          if(internalPath === '/internal/recovery-eligible'){
            const accountUid=new URL(request.url).searchParams.get('uid');
            if(!uid(accountUid))return new Response(null,{status:400});
            const offer=this.recoveryOffer(accountUid),customerId=await this.customerForUid(accountUid),pending=await this.pendingCheckout(accountUid);
            if(!offer || offer.expiresAt < now+3600 || !customerId || !pending?.sessionId)return Response.json({eligible:false});
            const row=this.sql.exec('SELECT reservation_json FROM customers WHERE uid=?',accountUid).toArray()[0];
            if(hasLifetimeAccess(await this.ports.legacyEntitlement(JSON.parse(row.reservation_json).email)))return Response.json({eligible:false});
            const snapshot=await this.ports.stripe.currentSubscriptionSnapshot({uid:accountUid,customerId});
            if(subscriptionEntitlement(snapshot,{uid:accountUid,customerId},this.config,now).active)return Response.json({eligible:false});
            const subscriptions=await this.ports.stripe.listAllSubscriptions(customerId);
            if(!Array.isArray(subscriptions)||subscriptions.some(s=>!['canceled','incomplete_expired'].includes(s.status)))return Response.json({eligible:false});
            const session=await this.ports.stripe.retrieveCheckoutSession(pending.sessionId);
            return Response.json({eligible:session.customer===customerId && session.client_reference_id===accountUid && session.livemode===this.config.expectedLivemode && session.status!=='complete'},{headers:{'Cache-Control':'no-store'}});
          }
          const data=[];
          for(const row of this.sql.exec('SELECT r.uid,r.data_json,c.reservation_json FROM recovery_offers r JOIN customers c ON c.uid=r.uid LIMIT 5000').toArray()){
            const offer=JSON.parse(row.data_json),reservation=JSON.parse(row.reservation_json);
            if(offer.createdAt > now-3600 || offer.expiresAt < now+3600 || !reservation.email)continue;
            data.push({uid:row.uid,email:reservation.email,expiresAt:offer.expiresAt,sourceSessionId:offer.sourceSessionId});
          }
          return Response.json({data},{headers:{'Cache-Control':'no-store'}});
        });
      }
      return await createBillingHandler(this.config, this.ports)(request);
    } catch (error) { return unavailable(error); }
  }

  async exclusive(action) {
    this.enabled();
    // Catch inside the gate so a normal provider failure does not reset the DO.
    const outcome = await this.ctx.blockConcurrencyWhile(async () => {
      const controller = new AbortController();
      const timeout = this.workflowTimeoutMs();
      const context = { signal: controller.signal, deadline: Date.now() + timeout };
      const expired = () => new BillingError('workflow_deadline_exceeded', 503);
      const timer = setTimeout(() => controller.abort(expired()), timeout);
      try {
        // Scope by async chain, not by mutable object state: another request's
        // pre-gate authentication must retain its own normal provider budget.
        return await this.operationContexts.run(context, async () => {
          try {
            const value = await action();
            if (controller.signal.aborted) throw expired();
            return { value };
          } catch (error) { return { error: controller.signal.aborted ? expired() : error }; }
        });
      } finally {
        // Never race action() against a timer. Providers receive the abort and
        // are awaited through settlement before this concurrency gate opens.
        clearTimeout(timer);
      }
    });
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }
  runExclusive(accountUid, action) {
    if (!uid(accountUid)) fail('account_binding_invalid');
    return this.exclusive(action);
  }
  runProcessingExclusive(action) { return this.exclusive(action); }

  customerForUid(accountUid) {
    if (!uid(accountUid)) fail('account_binding_invalid');
    return this.sql.exec('SELECT customer_id FROM customers WHERE uid = ?', accountUid).toArray()[0]?.customer_id ?? null;
  }
  reserveCustomer(accountUid, proposed) {
    this.enabled();
    if (!uid(accountUid) || !uuid(proposed?.requestId) || !integer(proposed?.createdAt)
      || typeof proposed.email !== 'string' || proposed.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed.email)) fail('customer_reservation_invalid');
    // Insert-once preserves original parameters/idempotency key under retries.
    this.sql.exec('INSERT INTO customers(uid, customer_id, reservation_json, created_at, updated_at) VALUES(?, NULL, ?, ?, ?) ON CONFLICT(uid) DO NOTHING',
      accountUid, JSON.stringify({ requestId: proposed.requestId, createdAt: proposed.createdAt, email: proposed.email }), this.now(), this.now());
    return JSON.parse(this.sql.exec('SELECT reservation_json FROM customers WHERE uid = ?', accountUid).one().reservation_json);
  }
  async bindCustomer(accountUid, customerId) {
    this.enabled();
    if (!uid(accountUid) || !customer(customerId)) fail('customer_binding_invalid');
    await this.ctx.storage.transaction(async storage => {
      const existing = this.sql.exec('SELECT customer_id FROM customers WHERE uid = ?', accountUid).toArray()[0];
      if (!existing || (existing.customer_id && existing.customer_id !== customerId)) fail('customer_binding_conflict');
      const reverse = this.sql.exec('SELECT uid FROM customers WHERE customer_id = ?', customerId).toArray()[0];
      if (reverse && reverse.uid !== accountUid) fail('customer_binding_conflict');
      this.sql.exec('UPDATE customers SET customer_id = ?, updated_at = ? WHERE uid = ?', customerId, this.now(), accountUid);
      this.sql.exec('INSERT INTO customer_reconciliation(uid, next_attempt_at) VALUES(?, ?) ON CONFLICT(uid) DO NOTHING',
        accountUid, this.now() + RECONCILIATION_INITIAL_DELAY_MS);
      await this.scheduleNextAlarm(storage);
    });
  }
  recoveryOffer(accountUid) {
    if (!uid(accountUid)) fail('account_binding_invalid');
    const row=this.sql.exec('SELECT data_json FROM recovery_offers WHERE uid = ?',accountUid).toArray()[0];
    return row ? JSON.parse(row.data_json) : null;
  }
  reserveRecoveryOffer(accountUid,offer) {
    this.enabled();
    if (!uid(accountUid) || !integer(offer.createdAt) || offer.expiresAt !== offer.createdAt+172800 || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(offer.sourceSessionId)) fail('checkout_reservation_invalid');
    this.sql.exec('INSERT INTO recovery_offers(uid,data_json) VALUES(?,?) ON CONFLICT(uid) DO NOTHING',accountUid,JSON.stringify(offer));
    return this.recoveryOffer(accountUid);
  }
  pendingCheckout(accountUid) {
    if (!uid(accountUid)) fail('account_binding_invalid');
    const row = this.sql.exec('SELECT data_json FROM checkout_reservations WHERE uid = ?', accountUid).toArray()[0];
    return row ? JSON.parse(row.data_json) : null;
  }
  savePendingCheckout(accountUid, proposed) {
    this.enabled();
    if (!uid(accountUid) || !['monthly', 'annual', 'lifetime'].includes(proposed?.plan) || !uuid(proposed?.requestId)
      || !uuid(proposed?.operationId) || !integer(proposed?.createdAt) || !proposed.parameters
      || JSON.stringify(proposed).length > 8192 || (proposed.sessionId && !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(proposed.sessionId))) fail('checkout_reservation_invalid');
    this.sql.exec('INSERT INTO checkout_reservations(uid, session_id, data_json, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET session_id = excluded.session_id, data_json = excluded.data_json, updated_at = excluded.updated_at',
      accountUid, proposed.sessionId || null, JSON.stringify(proposed), this.now());
  }
  retirePendingCheckout(accountUid, sessionId) {
    this.enabled();
    if (!uid(accountUid) || typeof sessionId !== 'string') fail('checkout_reservation_invalid');
    const result = this.sql.exec('DELETE FROM checkout_reservations WHERE uid = ? AND session_id = ?', accountUid, sessionId);
    return result.rowsWritten === 1;
  }

  async resolveEventBinding(event) {
    const resolved = await this.ports.stripe.resolveEventCustomer(event);
    if (!customer(resolved?.customerId) || resolved.customer?.id !== resolved.customerId
      || resolved.customer?.livemode !== this.config.expectedLivemode) fail('event_binding_unresolved', 503);
    const row = this.sql.exec('SELECT uid FROM customers WHERE customer_id = ?', resolved.customerId).toArray()[0];
    if (!row || resolved.customer.metadata?.firebaseUid !== row.uid) fail('event_binding_unresolved', 503);
    return { uid: row.uid, customerId: resolved.customerId };
  }

  validateEnvelope(event) {
    const keys = ['schemaVersion', 'eventId', 'type', 'objectId', 'livemode', 'created', 'receivedAt'];
    if (!event || Object.keys(event).some(key => !keys.includes(key)) || event.schemaVersion !== BILLING_SCHEMA
      || !/^evt_[A-Za-z0-9]+$/.test(event.eventId) || !SUPPORTED_EVENTS.has(event.type)
      || !/^[a-z]+_(?:test_|live_)?[A-Za-z0-9]+$/.test(event.objectId) || event.livemode !== this.config.expectedLivemode
      || !integer(event.created) || !integer(event.receivedAt)) fail('queue_event_invalid');
  }
  async writeAlarm(storage, at) { await storage.setAlarm(at); }
  async enqueue(event) {
    this.enabled(); this.validateEnvelope(event);
    let duplicate = false;
    await this.ctx.storage.transaction(async storage => {
      const existing = this.sql.exec('SELECT envelope_json, status, next_attempt_at FROM billing_events WHERE event_id = ?', event.eventId).toArray()[0];
      if (existing) {
        const prior = JSON.parse(existing.envelope_json);
        if (!sameCheckoutParameters({ ...prior, receivedAt: 0 }, { ...event, receivedAt: 0 })) fail('event_identity_conflict');
        duplicate = true;
      } else {
        this.sql.exec('INSERT INTO billing_events(event_id, envelope_json, status, next_attempt_at, received_at) VALUES(?, ?, ?, ?, ?)',
          event.eventId, JSON.stringify(event), 'pending', this.now() + 1000, this.now());
      }
      await this.scheduleNextAlarm(storage);
    });
    return { duplicate };
  }
  queuedEvent(eventId) {
    const row = this.sql.exec('SELECT envelope_json, status FROM billing_events WHERE event_id = ?', eventId).toArray()[0];
    return row ? { event: JSON.parse(row.envelope_json), processed: row.status === 'processed' } : null;
  }
  markProcessed(eventId, data) {
    this.enabled();
    if (!integer(data?.processedAt)) fail('processing_result_invalid');
    this.sql.exec("UPDATE billing_events SET status = 'processed', processed_at = ?, last_error = NULL, ignored = ? WHERE event_id = ? AND status = 'pending'",
      data.processedAt, data.ignored === true ? 1 : 0, eventId);
  }
  async scheduleNextAlarm(storage = this.ctx.storage) {
    const next = this.sql.exec(`SELECT MIN(due) AS next FROM (
      SELECT MIN(next_attempt_at) AS due FROM billing_events WHERE status = 'pending'
      UNION ALL SELECT MIN(next_attempt_at) AS due FROM customer_reconciliation
    )`).one().next;
    if (next === null) await storage.deleteAlarm();
    else {
      const now = this.now();
      const at = Math.max(now + 1000, next);
      // New deliveries must not continually postpone already-due work. Once
      // it finishes, its future due date can replace the former retry alarm.
      const scheduled = await storage.getAlarm();
      if (next <= now && scheduled !== null && scheduled <= at) return;
      await this.writeAlarm(storage, at);
    }
  }
  async rearmFromDurableState() {
    // Invoked through the private namespace by the hourly scheduled Worker.
    // Never run canonical/provider work here or reset existing due/backoff data.
    if (this.config.serviceEnabled !== true) return;
    await this.ctx.storage.transaction(storage => this.scheduleNextAlarm(storage));
  }
  async finishReconciliation(accountUid, error = null) {
    this.enabled();
    await this.ctx.storage.transaction(async storage => {
      const row = this.sql.exec('SELECT attempts FROM customer_reconciliation WHERE uid = ?', accountUid).one();
      if (error) this.sql.exec('UPDATE customer_reconciliation SET next_attempt_at = ?, last_error = ? WHERE uid = ?',
        this.now() + retryDelay(row.attempts), errorCode(error), accountUid);
      else this.sql.exec('UPDATE customer_reconciliation SET next_attempt_at = ?, attempts = 0, last_success_at = ?, last_error = NULL WHERE uid = ?',
        this.now() + RECONCILIATION_INTERVAL_MS, this.now(), accountUid);
      await this.scheduleNextAlarm(storage);
    });
  }
  async claimWork(kind, id) {
    this.enabled();
    // Commit a retry deadline BEFORE external work. A reset mid-fetch retains
    // backoff rather than repeatedly hammering the same failed customer.
    await this.ctx.storage.transaction(async storage => {
      const table = kind === 'event' ? 'billing_events' : 'customer_reconciliation';
      const key = kind === 'event' ? 'event_id' : 'uid';
      const attempts = this.sql.exec(`SELECT attempts FROM ${table} WHERE ${key} = ?`, id).one().attempts + 1;
      this.sql.exec(`UPDATE ${table} SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE ${key} = ?`,
        attempts, this.now() + retryDelay(attempts), 'attempt_unfinished', id);
      this.sql.exec('UPDATE billing_alarm_state SET next_kind = ? WHERE id = 1', kind === 'event' ? 'customer' : 'event');
      await this.scheduleNextAlarm(storage);
    });
  }
  async alarm() {
    if (this.config.serviceEnabled !== true) { await this.ctx.storage.deleteAlarm(); return; }
    const now = this.now();
    const events = this.sql.exec("SELECT event_id AS id FROM billing_events WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, event_id LIMIT ?", now, ALARM_BATCH_SIZE).toArray();
    const customers = this.sql.exec('SELECT uid AS id FROM customer_reconciliation WHERE next_attempt_at <= ? ORDER BY next_attempt_at, uid LIMIT ?', now, ALARM_BATCH_SIZE).toArray();
    let nextKind = this.sql.exec('SELECT next_kind FROM billing_alarm_state WHERE id = 1').one().next_kind;
    // Alternating persisted preference prevents either queue starving, even if
    // alarms restart with an unending webhook backlog. Oldest due wins per kind.
    for (let count = 0; count < ALARM_BATCH_SIZE && (events.length || customers.length); count++) {
      const kind = nextKind === 'event' ? (events.length ? 'event' : 'customer') : (customers.length ? 'customer' : 'event');
      const { id } = (kind === 'event' ? events : customers).shift();
      nextKind = kind === 'event' ? 'customer' : 'event';
      await this.claimWork(kind, id);
      if (kind === 'customer') {
        try {
          await reconcileBoundCustomer(id, this.config, this.ports, Math.floor(this.now() / 1000));
          await this.finishReconciliation(id);
        } catch (error) { await this.finishReconciliation(id, error); }
      } else {
        try { await processQueuedEvent(id, this.config, this.ports, Math.floor(this.now() / 1000)); }
        catch (error) {
          const row = this.sql.exec('SELECT attempts FROM billing_events WHERE event_id = ?', id).one();
          this.sql.exec("UPDATE billing_events SET next_attempt_at = ?, last_error = ? WHERE event_id = ? AND status = 'pending'",
            this.now() + retryDelay(row.attempts), errorCode(error), id);
        }
      }
    }
    await this.scheduleNextAlarm();
  }
  getOperationalSummary() {
    // No public HTTP route exposes this; intended for a future trusted operator.
    return {
      pending: this.sql.exec("SELECT COUNT(*) AS count FROM billing_events WHERE status = 'pending'").one().count,
      processed: this.sql.exec("SELECT COUNT(*) AS count FROM billing_events WHERE status = 'processed'").one().count,
      failing: this.sql.exec("SELECT COUNT(*) AS count FROM billing_events WHERE status = 'pending' AND last_error IS NOT NULL AND last_error <> 'attempt_unfinished'").one().count,
      unfinished: this.sql.exec("SELECT COUNT(*) AS count FROM billing_events WHERE status = 'pending' AND last_error = 'attempt_unfinished'").one().count,
      reconciliation: {
        customers: this.sql.exec('SELECT COUNT(*) AS count FROM customer_reconciliation').one().count,
        due: this.sql.exec('SELECT COUNT(*) AS count FROM customer_reconciliation WHERE next_attempt_at <= ?', this.now()).one().count,
        failing: this.sql.exec("SELECT COUNT(*) AS count FROM customer_reconciliation WHERE last_error IS NOT NULL AND last_error <> 'attempt_unfinished'").one().count,
        unfinished: this.sql.exec("SELECT COUNT(*) AS count FROM customer_reconciliation WHERE last_error = 'attempt_unfinished'").one().count,
        neverSucceeded: this.sql.exec('SELECT COUNT(*) AS count FROM customer_reconciliation WHERE last_success_at IS NULL').one().count,
        nextDueAt: this.sql.exec('SELECT MIN(next_attempt_at) AS next FROM customer_reconciliation').one().next,
      },
    };
  }
}
