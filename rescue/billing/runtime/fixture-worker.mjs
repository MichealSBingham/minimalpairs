/** Local test fixture only. Never imported by runtime/worker.mjs or Wrangler. */
import { BillingLedgerBase } from './ledger.mjs';
import { BillingError } from '../core.mjs';
import { billingConfig, unavailable } from './config.mjs';
import { billingLedgerName, wakeBillingLedger } from './scheduled.mjs';

const testUid = 'runtime_synthetic_uid';
const testCustomer = { id: 'cus_runtime', livemode: false, metadata: { firebaseUid: testUid } };

export class FixtureLedger extends BillingLedgerBase {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql.exec('CREATE TABLE IF NOT EXISTS fixture_values(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);');
  }
  read(key, fallback = null) {
    const row = this.sql.exec('SELECT value_json FROM fixture_values WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value_json) : fallback;
  }
  put(key, value) { this.sql.exec('INSERT INTO fixture_values(key, value_json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', key, JSON.stringify(value)); }
  increment(key) { const value = this.read(key, 0) + 1; this.put(key, value); return value; }
  workflowTimeoutMs() { return this.read('workflow_timeout_ms', super.workflowTimeoutMs()); }
  trace(value) { this.put('operation_trace', [...this.read('operation_trace', []), value]); }
  async cooperativeDelay(label, duration, cleanup = 0) {
    const context = this.getOperationContext();
    if (!context) throw new BillingError('fixture_context_missing', 503);
    this.trace(`${label}:start`);
    await new Promise((resolve, reject) => {
      let timer;
      const aborted = () => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', aborted);
        this.trace(`${label}:abort`);
        // Deliberate asynchronous cleanup proves that the real gate stays held
        // after abort until the operation has actually settled.
        setTimeout(() => { this.trace(`${label}:settled`); reject(context.signal.reason); }, cleanup);
      };
      if (context.signal.aborted) { aborted(); return; }
      context.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => {
        context.signal.removeEventListener('abort', aborted);
        this.trace(`${label}:effect`); resolve();
      }, duration);
    });
  }
  async writeAlarm(storage, at) {
    if (this.read('fail_alarm_write', false)) throw new BillingError('simulated_alarm_storage_failure', 503);
    return super.writeAlarm(storage, at);
  }
  savePendingCheckout(accountUid, proposed) {
    if (proposed.sessionId && this.read('fail_checkout_save', false)) throw new BillingError('simulated_checkout_storage_failure', 503);
    return super.savePendingCheckout(accountUid, proposed);
  }
  markProcessed(eventId, data) {
    if (this.read('fail_processed_save', false)) throw new BillingError('simulated_processed_storage_failure', 503);
    return super.markProcessed(eventId, data);
  }
  async finishReconciliation(accountUid, error = null) {
    if (!error && this.read('fail_reconciliation_save', false)) throw new BillingError('simulated_reconciliation_storage_failure', 503);
    return super.finishReconciliation(accountUid, error);
  }
  createExternalPorts() {
    const bump = name => this.increment(`calls_${name}`);
    return {
      auth: { verifyIdToken: async () => ({ uid: testUid, email: 'runtime@example.invalid', emailVerified: true, serverVerified: true }) },
      legacyEntitlement: async () => null,
      stripe: {
        createCustomer: async (params, key) => {
          const call = bump('createCustomer');
          if (call === 1 && this.read('slow_customer_once', false)) await this.cooperativeDelay('customer_slow', 500, 60);
          else this.trace('customer_normal:start');
          // An actual await forces input-gate concurrency to matter.
          await new Promise(resolve => setTimeout(resolve, 10));
          const previous = this.read(`stripe_${key}`);
          if (previous) return previous;
          this.put(`stripe_${key}`, testCustomer); return testCustomer;
        },
        retrieveCustomer: async () => testCustomer,
        listAllSubscriptions: async () => [],
        createCheckoutSession: async (params, key) => {
          bump('createCheckout');
          await new Promise(resolve => setTimeout(resolve, 10));
          const previous = this.read(`stripe_${key}`);
          if (previous) return previous;
          this.increment('unique_stripe_checkouts');
          const value = { id: 'cs_test_runtime', mode: 'subscription', customer: testCustomer.id, client_reference_id: testUid,
            status: 'open', livemode: false, url: 'https://checkout.stripe.com/c/pay/cs_test_runtime' };
          this.put(`stripe_${key}`, value); return value;
        },
        retrieveCheckoutSession: async () => ({ id: 'cs_test_runtime', mode: 'subscription', customer: testCustomer.id, client_reference_id: testUid,
          status: 'open', livemode: false, url: 'https://checkout.stripe.com/c/pay/cs_test_runtime', ...this.read('checkout_overrides', {}) }),
        resolveEventCustomer: async () => {
          if (this.read('slow_resolver', false)) await this.cooperativeDelay('resolver_slow', 500, 30);
          return { customerId: testCustomer.id, customer: testCustomer, subscriptionId: 'sub_runtime' };
        },
        currentSubscriptionSnapshot: async bound => {
          bump('snapshot'); const now = Math.floor(Date.now() / 1000);
          this.trace(`snapshot:${bound.uid}`);
          if (this.read('slow_snapshot', false)) await this.cooperativeDelay('snapshot_slow', 500, 30);
          return { ...bound, livemode: false, subscriptionId: 'sub_runtime', priceId: 'price_monthly', status: 'active',
            itemCount: 1, quantity: 1, currency: 'usd', interval: 'month', intervalCount: 1,
            currentPeriodStart: now - 3600, currentPeriodEnd: now + 3600,
            paidPeriods: [{ invoiceId: 'in_runtime', subscriptionId: 'sub_runtime', priceId: 'price_monthly', invoiceStatus: 'paid',
              successfulCharge: true, amountPaid: 900, amountRefunded: 0, disputeStatus: 'none', currency: 'usd', start: now - 3600, end: now + 3600,
              ...this.read('paid_period_overrides', {}) }], ...this.read('snapshot_overrides', {}) };
        },
      },
      entitlements: { projectSubscription: async (accountUid, value) => {
        bump('projection');
        if (this.read('fail_projection', false)) throw new Error('synthetic@example.invalid private error must never enter ledger');
        this.put(`grant_${accountUid}`, value);
      } },
    };
  }
  async fetch(request) {
    if (new URL(request.url).pathname !== '/__fixture') return super.fetch(request);
    try {
      const { operation, args = [] } = await request.json();
      let data;
      switch (operation) {
        case 'reserveCustomer': data = this.reserveCustomer(...args); break;
        case 'bindCustomer': data = await this.bindCustomer(...args); break;
        case 'customerForUid': data = this.customerForUid(...args); break;
        case 'pendingCheckout': data = this.pendingCheckout(...args); break;
        case 'savePendingCheckout': data = this.savePendingCheckout(...args); break;
        case 'retirePendingCheckout': data = this.retirePendingCheckout(...args); break;
        case 'enqueue': data = await this.enqueue(...args); break;
        case 'queuedEvent': data = this.queuedEvent(...args); break;
        case 'summary': data = this.getOperationalSummary(); break;
        case 'read': data = this.read(...args); break;
        case 'put': data = this.put(...args); break;
        case 'contextIsolation': {
          const before = this.getOperationContext();
          const inside = await this.runProcessingExclusive(async () => {
            const original = this.getOperationContext();
            const outside = this.operationContexts.exit(() => this.getOperationContext());
            await new Promise(resolve => setTimeout(resolve, 30));
            return { outside, present: original?.signal instanceof AbortSignal, same: this.getOperationContext() === original };
          });
          data = { before, inside, after: this.getOperationContext() }; break;
        }
        case 'eventState': data = this.sql.exec('SELECT * FROM billing_events WHERE event_id = ?', args[0]).toArray()[0] ?? null; break;
        case 'reconciliationState': data = this.sql.exec('SELECT * FROM customer_reconciliation WHERE uid = ?', args[0]).toArray()[0] ?? null; break;
        case 'alarmAt': data = await this.ctx.storage.getAlarm(); break;
        case 'deleteAlarm': await this.ctx.storage.deleteAlarm(); data = true; break;
        case 'setReconciliationSchedule':
          this.sql.exec('UPDATE customer_reconciliation SET next_attempt_at = ? WHERE uid = ?', args[1], args[0]);
          await this.ctx.storage.setAlarm(args[2]); data = true; break;
        case 'reconciliationDue':
          this.sql.exec('UPDATE customer_reconciliation SET next_attempt_at = ? WHERE uid = ?', Date.now() - 1, args[0]);
          await this.ctx.storage.setAlarm(Date.now() + 20); data = true; break;
        case 'prepareBatch': {
          const at = Date.now() - 1;
          this.sql.exec("UPDATE billing_events SET next_attempt_at = ? WHERE status = 'pending'", at);
          this.sql.exec('UPDATE customer_reconciliation SET next_attempt_at = ?', at);
          await this.ctx.storage.deleteAlarm(); data = true; break;
        }
        case 'runAlarm': await this.alarm(); data = true; break;
        case 'removeReconciliationForUpgrade':
          this.sql.exec('DELETE FROM customer_reconciliation WHERE uid = ?', args[0]);
          await this.ctx.storage.deleteAlarm(); data = true; break;
        case 'due':
          this.sql.exec("UPDATE billing_events SET next_attempt_at = ? WHERE status = 'pending'", Date.now() - 1);
          await this.ctx.storage.setAlarm(Date.now() + 20); data = true; break;
        case 'evict': this.ctx.abort('Synthetic local eviction'); break;
        default: throw new BillingError('unknown_fixture_operation', 404);
      }
      return Response.json({ data: data ?? null });
    } catch (error) { return unavailable(error); }
  }
}

export default {
  async fetch(request, env) { return env.BILLING_LEDGER.getByName(billingLedgerName(billingConfig(env))).fetch(request); },
  scheduled: wakeBillingLedger,
};
