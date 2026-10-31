import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { billingConfig } from './config.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const testUid = 'runtime_synthetic_uid';
const secret = 'whsec_runtimeSyntheticOnly';
const settings = {
  appOrigin: 'https://minimalpairs.co', expectedLivemode: false, portalConfigurationId: 'bpc_runtime',
  prices: {
    monthly: { id: 'price_monthly', currency: 'usd', interval: 'month', intervalCount: 1 },
    annual: { id: 'price_annual', currency: 'usd', interval: 'year', intervalCount: 1 },
  },
};
let bundle;
before(async () => {
  const result = await build({ entryPoints: [join(directory, 'fixture-worker.mjs')], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers', 'node:async_hooks'] });
  bundle = result.outputFiles[0].text;
});

function options(path, enabled = true, script = bundle, className = 'FixtureLedger', config=settings) {
  const opts = convertV4MiniflareOptions({ name: 'billing-local-test', modules: true, script,
    compatibilityDate: '2026-09-26', cf: false, host: '127.0.0.1', log: new Log(LogLevel.ERROR),
    durableObjects: { BILLING_LEDGER: { className, useSQLite: true } }, durableObjectsPersist: path,
    bindings: { BILLING_SERVICE_ENABLED: String(enabled), BILLING_CHECKOUT_ENABLED: 'true', BILLING_COMMUNICATIONS_APPROVED: 'true',
      PURCHASE_FEED_TOKEN:'fixture-feed', BILLING_CONFIG_JSON: JSON.stringify(config), STRIPE_WEBHOOK_SECRETS_JSON: JSON.stringify([secret]) },
    outboundService: () => { throw new Error('Unexpected external network request in local billing test'); },
  });
  opts.telemetry = { enabled: false };
  // Miniflare 5's v4 converter intentionally omits old *Persist options.
  // Pin the actual new storage location so a fresh process reopens SQLite.
  opts.resourcePersistencePath = path;
  opts.isolatedResourcePersistencePath = path;
  for (const worker of opts.workers) worker.dev.unsafeRegisterWorker = false;
  return opts;
}
async function runtime(t, enabled = true) {
  const path = await mkdtemp(join(tmpdir(), 'minimalpairs-billing-runtime-'));
  let mf = new Miniflare(options(path, enabled)); await mf.ready;
  t.after(async () => { await mf.dispose(); await rm(path, { recursive: true, force: true }); });
  return {
    get mf() { return mf; }, path,
    async restart(nextEnabled = enabled) { await mf.dispose(); mf = new Miniflare(options(path, nextEnabled)); await mf.ready; },
    async control(operation, ...args) {
      const response = await mf.dispatchFetch('https://local.invalid/__fixture', { method: 'POST', body: JSON.stringify({ operation, args }) });
      const value = await response.json();
      return { status: response.status, ...value };
    },
    async data(operation, ...args) {
      const response = await this.control(operation, ...args);
      assert.equal(response.status, 200, JSON.stringify(response)); return response.data;
    },
    checkout(requestId = randomUUID()) {
      return mf.dispatchFetch('https://local.invalid/billing/checkout', { method: 'POST',
        headers: { Origin: settings.appOrigin, Authorization: 'Bearer synthetic.server.verified.token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'monthly', requestId }) });
    },
  };
}
const reservation = () => ({ requestId: randomUUID(), createdAt: Math.floor(Date.now() / 1000), email: 'runtime@example.invalid' });
const envelope = (eventId = 'evt_runtime') => ({ schemaVersion: 1, eventId, type: 'invoice.paid', objectId: 'in_runtime',
  livemode: false, created: Math.floor(Date.now() / 1000), receivedAt: Math.floor(Date.now() / 1000) });
async function bind(rt) { await rt.data('reserveCustomer', testUid, reservation()); await rt.data('bindCustomer', testUid, 'cus_runtime'); }
async function until(check, label) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail(`Timed out waiting for ${label}`);
}

test('config requires three exact server switches; embedded JSON cannot enable service', () => {
  const config = billingConfig({ BILLING_CONFIG_JSON: JSON.stringify({ serviceEnabled: true, checkoutEnabled: true, communicationsApproved: true }) });
  assert.equal(config.serviceEnabled, false); assert.equal(config.checkoutEnabled, false); assert.equal(config.communicationsApproved, false);
  assert.equal(billingConfig({ BILLING_SERVICE_ENABLED: true }).serviceEnabled, false);
  assert.throws(() => billingConfig({ BILLING_CONFIG_JSON: '{' }), /billing_config_invalid/);
});
test('disabled local DO rejects requests and background queue writes with no provider activity', async t => {
  const rt = await runtime(t, false);
  assert.equal((await rt.checkout()).status, 503);
  assert.equal((await rt.control('enqueue', envelope())).status, 503);
  assert.equal(await rt.data('read', 'calls_createCustomer', 0), 0);
  assert.deepEqual(await rt.data('summary'), { pending: 0, processed: 0, failing: 0, unfinished: 0,
    reconciliation: { customers: 0, due: 0, failing: 0, unfinished: 0, neverSucceeded: 0, nextDueAt: null } });
});
test('real SQLite preserves one reservation under concurrent requests and prevents cross-UID customer reuse', async t => {
  const rt = await runtime(t);
  const results = await Promise.all(Array.from({ length: 24 }, () => rt.data('reserveCustomer', 'same_uid', reservation())));
  assert.equal(new Set(results.map(value => value.requestId)).size, 1);
  await rt.data('bindCustomer', 'same_uid', 'cus_unique');
  await rt.data('reserveCustomer', 'second_uid', reservation());
  assert.equal((await rt.control('bindCustomer', 'second_uid', 'cus_unique')).status, 409);
  assert.equal((await rt.control('bindCustomer', 'same_uid', 'cus_replacement')).status, 409);
  assert.equal(await rt.data('customerForUid', 'same_uid'), 'cus_unique');
  assert.equal(await rt.data('customerForUid', 'second_uid'), null);
});
test('concurrent actual Worker checkout requests create one customer and one Checkout', async t => {
  const rt = await runtime(t);
  const responses = await Promise.all(Array.from({ length: 16 }, () => rt.checkout()));
  assert.deepEqual(responses.map(response => response.status), Array(16).fill(200));
  assert.equal(await rt.data('read', 'calls_createCustomer'), 1);
  assert.equal(await rt.data('read', 'calls_createCheckout'), 1);
  assert.equal(await rt.data('read', 'unique_stripe_checkouts'), 1);
});

test('explicit expired-checkout checks retire one exact SQLite reservation across concurrent requests and restart', async t => {
  const rt = await runtime(t);
  assert.equal((await rt.checkout()).status, 200);
  await rt.data('put', 'checkout_overrides', { status: 'expired', url: null });
  const inspect = async () => {
    const response = await rt.mf.dispatchFetch('https://local.invalid/billing/checkout-status', { method: 'POST',
      headers: { Origin: settings.appOrigin, Authorization: 'Bearer synthetic.server.verified.token', 'Content-Type': 'application/json' }, body: '{}' });
    return { status: response.status, body: await response.json() };
  };
  const responses = await Promise.all(Array.from({ length: 8 }, inspect));
  for (const response of responses) assert.deepEqual(response, { status: 200, body: { state: 'none' } });
  assert.equal(await rt.data('pendingCheckout', testUid), null);
  assert.equal(await rt.data('read', 'calls_createCheckout'), 1);
  assert.equal(await rt.data('read', 'calls_projection', 0), 0);
  await rt.restart();
  assert.equal(await rt.data('pendingCheckout', testUid), null);
  assert.deepEqual(await inspect(), { status: 200, body: { state: 'none' } });
  assert.equal(await rt.data('read', 'calls_createCheckout'), 1);
});

test('status request after an uncertain external creation preserves SQLite recovery instead of creating or forgetting a checkout', async t => {
  const rt = await runtime(t); await rt.data('put', 'fail_checkout_save', true);
  assert.equal((await rt.checkout()).status, 503);
  const before = await rt.data('pendingCheckout', testUid);
  assert.equal(before.sessionId, undefined);
  await rt.restart();
  const response = await rt.mf.dispatchFetch('https://local.invalid/billing/checkout-status', { method: 'POST',
    headers: { Origin: settings.appOrigin, Authorization: 'Bearer synthetic.server.verified.token', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'pending', plan: 'monthly', requestId: before.requestId, createdAt: before.createdAt });
  assert.deepEqual(await rt.data('pendingCheckout', testUid), before);
  assert.equal(await rt.data('read', 'calls_createCheckout'), 1);
});
test('shared deadline cancels slow checkout and holds the gate through awaited provider cleanup', async t => {
  const rt = await runtime(t);
  await rt.data('put', 'workflow_timeout_ms', 100);
  await rt.data('put', 'slow_customer_once', true);
  const started = Date.now();
  const responses = await Promise.all([rt.checkout(), rt.checkout()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 503]);
  const failed = responses.find(response => response.status === 503);
  assert.deepEqual(await failed.json(), { error: 'workflow_deadline_exceeded' });
  assert.ok(Date.now() - started < 3000, 'shared budget did not bound the workflow');
  const trace = await rt.data('read', 'operation_trace');
  assert.ok(trace.indexOf('customer_slow:abort') >= 0);
  assert.ok(trace.indexOf('customer_slow:settled') > trace.indexOf('customer_slow:abort'));
  assert.ok(trace.indexOf('customer_normal:start') > trace.indexOf('customer_slow:settled'), 'second checkout entered before cancellation settled');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal((await rt.data('read', 'operation_trace')).includes('customer_slow:effect'), false);
  assert.equal(await rt.data('read', 'calls_createCustomer'), 2);
  assert.equal(await rt.data('read', 'unique_stripe_checkouts'), 1);
  assert.equal(await rt.data('customerForUid', testUid), 'cus_runtime');
});
test('async operation context remains scoped across awaits and does not survive gate exit', async t => {
  const rt = await runtime(t);
  assert.deepEqual(await rt.data('contextIsolation'), { before: null, inside: { outside: null, present: true, same: true }, after: null });
});
test('crash boundary after fake provider creation survives full runtime restart with the same reserved key', async t => {
  const rt = await runtime(t); await rt.data('put', 'fail_checkout_save', true);
  assert.equal((await rt.checkout()).status, 503);
  const before = await rt.data('pendingCheckout', testUid);
  assert.equal(before.sessionId, undefined);
  await rt.restart(); await rt.data('put', 'fail_checkout_save', false);
  assert.equal((await rt.checkout()).status, 200);
  const after = await rt.data('pendingCheckout', testUid);
  assert.equal(after.operationId, before.operationId);
  assert.equal(after.sessionId, 'cs_test_runtime');
  assert.equal(await rt.data('read', 'calls_createCheckout'), 2);
  assert.equal(await rt.data('read', 'unique_stripe_checkouts'), 1);
});
test('actual Durable Object eviction preserves a committed reservation and customer binding', async t => {
  const rt = await runtime(t); await bind(rt); assert.equal((await rt.checkout()).status, 200);
  const original = await rt.data('pendingCheckout', testUid);
  await rt.mf.unsafeEvictDurableObject('billing-local-test', 'FixtureLedger', { name: 'billing-v1-test' });
  assert.equal(await rt.data('customerForUid', testUid), 'cus_runtime');
  assert.deepEqual(await rt.data('pendingCheckout', testUid), original);
  assert.equal((await rt.checkout()).status, 200);
  assert.equal(await rt.data('read', 'unique_stripe_checkouts'), 1);
});
test('queue deduplicates concurrent deliveries and rejects altered identity or extra payload fields', async t => {
  const rt = await runtime(t); const event = envelope();
  const results = await Promise.all(Array.from({ length: 20 }, () => rt.data('enqueue', event)));
  assert.equal(results.filter(value => !value.duplicate).length, 1);
  assert.equal((await rt.data('summary')).pending, 1);
  assert.equal((await rt.control('enqueue', { ...event, objectId: 'in_different' })).status, 409);
  assert.equal((await rt.control('enqueue', { ...event, email: 'not-permitted@example.invalid' })).status, 409);
  await rt.restart();
  assert.deepEqual((await rt.data('queuedEvent', event.eventId)).event, event);
});
test('SQL insert and alarm scheduling rollback together on an injected storage failure', async t => {
  const rt = await runtime(t); await rt.data('put', 'fail_alarm_write', true);
  assert.equal((await rt.control('enqueue', envelope())).status, 503);
  assert.equal(await rt.data('queuedEvent', 'evt_runtime'), null);
  await rt.data('put', 'fail_alarm_write', false);
  assert.deepEqual(await rt.data('enqueue', envelope()), { duplicate: false });
  assert.equal((await rt.data('summary')).pending, 1);
});
test('real alarm retries provider failure and records only sanitized error state', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('put', 'fail_projection', true);
  await rt.data('enqueue', envelope()); await rt.data('due');
  const failed = await until(async () => { const row = await rt.data('eventState', 'evt_runtime'); return row.last_error && row; }, 'failed projection');
  assert.equal(failed.status, 'pending'); assert.equal(failed.last_error, 'processing_failed');
  assert.ok(failed.next_attempt_at >= Date.now() + 50_000);
  assert.equal(JSON.stringify(failed).includes('example.invalid'), false);
  await rt.data('put', 'fail_projection', false); await rt.data('due');
  await until(async () => (await rt.data('queuedEvent', 'evt_runtime')).processed, 'successful retry');
  assert.equal((await rt.data('read', `grant_${testUid}`)).active, true);
  assert.equal(await rt.data('read', 'calls_projection'), 2);
});
test('pending attempt/error/backoff survive runtime restart without immediate retry', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('put', 'fail_projection', true);
  await rt.data('enqueue', envelope()); await rt.data('due');
  const previous = await until(async () => { const row = await rt.data('eventState', 'evt_runtime'); return row.last_error && row; }, 'first failure');
  await rt.restart();
  const persisted = await rt.data('eventState', 'evt_runtime');
  assert.equal(persisted.attempts, previous.attempts); assert.equal(persisted.last_error, previous.last_error);
  assert.equal(persisted.next_attempt_at, previous.next_attempt_at);
  assert.equal(await rt.data('read', 'calls_projection'), 1);
});
test('real alarm persists shared-deadline failure and retries after complete provider cancellation', async t => {
  const rt = await runtime(t); await bind(rt);
  await rt.data('put', 'workflow_timeout_ms', 80);
  await rt.data('put', 'slow_resolver', true);
  await rt.data('enqueue', envelope()); await rt.data('due');
  const failed = await until(async () => { const row = await rt.data('eventState', 'evt_runtime'); return row.last_error && row; }, 'canceled alarm workflow');
  assert.equal(failed.last_error, 'workflow_deadline_exceeded');
  assert.equal(failed.status, 'pending'); assert.equal(failed.attempts, 1);
  assert.ok(failed.next_attempt_at >= Date.now() + 50_000);
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
  assert.equal(await rt.data('read', 'calls_projection', 0), 0);
  assert.deepEqual(await rt.data('read', 'operation_trace'), ['resolver_slow:start', 'resolver_slow:abort', 'resolver_slow:settled']);
  await rt.restart();
  assert.equal((await rt.data('eventState', 'evt_runtime')).next_attempt_at, failed.next_attempt_at);
  await rt.data('put', 'slow_resolver', false); await rt.data('due');
  await until(async () => (await rt.data('queuedEvent', 'evt_runtime')).processed, 'successful retry after workflow deadline');
  assert.equal(await rt.data('read', 'calls_projection'), 1);
  assert.equal((await rt.data('eventState', 'evt_runtime')).attempts, 2);
  assert.equal((await rt.data('read', 'operation_trace')).includes('resolver_slow:effect'), false);
});
test('crash after projection retries fresh state and processes one event without losing the grant', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('put', 'fail_processed_save', true);
  await rt.data('enqueue', envelope()); await rt.data('due');
  await until(async () => (await rt.data('eventState', 'evt_runtime')).last_error, 'post-projection failure');
  assert.equal((await rt.data('read', `grant_${testUid}`)).active, true);
  await rt.restart(); await rt.data('put', 'fail_processed_save', false); await rt.data('due');
  await until(async () => (await rt.data('queuedEvent', 'evt_runtime')).processed, 'retry after restart');
  assert.equal(await rt.data('read', 'calls_snapshot'), 2);
  assert.equal(await rt.data('read', 'calls_projection'), 2);
  const stored = (await rt.data('queuedEvent', 'evt_runtime')).event;
  assert.equal((await rt.data('enqueue', { ...stored, receivedAt: stored.receivedAt + 1 })).duplicate, true);
  const { reconciliation, ...eventCounts } = await rt.data('summary');
  assert.deepEqual(eventCounts, { pending: 0, processed: 1, failing: 0, unfinished: 0 });
  assert.equal(reconciliation.customers, 1);
});
test('metadata alone cannot grant an event without the server-owned customer binding', async t => {
  const rt = await runtime(t); await rt.data('enqueue', envelope()); await rt.data('due');
  const failed = await until(async () => { const row = await rt.data('eventState', 'evt_runtime'); return row.last_error && row; }, 'unknown binding');
  assert.equal(failed.last_error, 'event_binding_unresolved');
  assert.equal(await rt.data('read', 'calls_projection', 0), 0);
});
test('compare-and-retire cannot erase a newer pending checkout', async t => {
  const rt = await runtime(t); assert.equal((await rt.checkout()).status, 200);
  const old = await rt.data('pendingCheckout', testUid);
  await rt.data('savePendingCheckout', testUid, { ...old, sessionId: 'cs_test_replacement', operationId: randomUUID() });
  assert.equal(await rt.data('retirePendingCheckout', testUid, old.sessionId), false);
  assert.equal((await rt.data('pendingCheckout', testUid)).sessionId, 'cs_test_replacement');
  assert.equal(await rt.data('retirePendingCheckout', testUid, 'cs_test_replacement'), true);
  assert.equal(await rt.data('pendingCheckout', testUid), null);
});
test('disabled restart preserves queue without processing; re-enable resumes durable work', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('enqueue', envelope());
  await rt.restart(false); await rt.data('due');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await rt.data('read', 'calls_projection', 0), 0);
  assert.equal((await rt.data('queuedEvent', 'evt_runtime')).processed, false);
  await rt.restart(true);
  await until(async () => (await rt.data('queuedEvent', 'evt_runtime')).processed, 'enabled deployment resumes queue');
  assert.equal(await rt.data('read', 'calls_projection'), 1);
});
test('signed HTTP webhook reaches durable local SQLite before acknowledgement', async t => {
  const rt = await runtime(t); const now = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({ id: 'evt_http', type: 'invoice.paid', created: now, livemode: false, data: { object: { id: 'in_runtime' } } });
  const signature = createHmac('sha256', secret).update(`${now}.${raw}`).digest('hex');
  const response = await rt.mf.dispatchFetch('https://local.invalid/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${now},v1=${signature}` }, body: raw });
  assert.equal(response.status, 200);
  await rt.restart(); assert.equal((await rt.data('queuedEvent', 'evt_http')).event.objectId, 'in_runtime');
});
test('production Worker bundles without fixture routes and stays disabled without any credentials', async t => {
  const result = await build({ entryPoints: [join(directory, 'worker.mjs')], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers', 'node:async_hooks'] });
  const source = result.outputFiles[0].text;
  assert.equal(source.includes('fixture_values'), false); assert.equal(source.includes('/__fixture'), false);
  const config = JSON.parse(await readFile(join(directory, '..', 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(config.vars.BILLING_SERVICE_ENABLED, 'false'); assert.equal(config.vars.BILLING_CHECKOUT_ENABLED, 'false');
  assert.equal(config.vars.BILLING_COMMUNICATIONS_APPROVED, 'false');
  assert.deepEqual(config.triggers, { crons: ['0 * * * *'] });
  const path = await mkdtemp(join(tmpdir(), 'minimalpairs-billing-production-smoke-'));
  const mf = new Miniflare(options(path, false, source, 'BillingLedger'));
  t.after(async () => { await mf.dispose(); await rm(path, { recursive: true, force: true }); });
  const response = await mf.dispatchFetch('https://local.invalid/billing/checkout', { method: 'POST' });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'billing_not_enabled' });
  assert.equal((await mf.dispatchFetch('https://local.invalid/__fixture', { method: 'POST' })).status, 404);
  const scheduled = await (await mf.getWorker()).scheduled({ cron: '0 * * * *' });
  assert.equal(scheduled.outcome, 'ok');
  // Disabled edge routes and the real scheduled handler never bind an object.
  assert.deepEqual(await mf.listDurableObjectIds('BillingLedger', 'billing-local-test'), []);
});

test('binding atomically schedules one initial canonical check; unbound reservations never enter the queue', async t => {
  const rt = await runtime(t);
  await rt.data('reserveCustomer', testUid, reservation());
  assert.equal(await rt.data('reconciliationState', testUid), null);
  await rt.data('put', 'fail_alarm_write', true);
  assert.equal((await rt.control('bindCustomer', testUid, 'cus_runtime')).status, 503);
  assert.equal(await rt.data('customerForUid', testUid), null);
  assert.equal(await rt.data('reconciliationState', testUid), null);
  await rt.data('put', 'fail_alarm_write', false);
  const before = Date.now(); await rt.data('bindCustomer', testUid, 'cus_runtime');
  const state = await rt.data('reconciliationState', testUid);
  assert.ok(state.next_attempt_at >= before + 60_000 && state.next_attempt_at <= Date.now() + 60_000);
  assert.equal(await rt.data('alarmAt'), state.next_attempt_at);
  await rt.data('bindCustomer', testUid, 'cus_runtime');
  assert.deepEqual(await rt.data('reconciliationState', testUid), state);
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
});
test('actual alarm repairs a missed renewal and later full refund without any webhook record', async t => {
  const rt = await runtime(t); await bind(rt);
  const renewalEnd = Math.floor(Date.now() / 1000) + 7200;
  await rt.data('put', `grant_${testUid}`, { active: false, currentPeriodEnd: 1 });
  await rt.data('put', 'snapshot_overrides', { currentPeriodEnd: renewalEnd });
  await rt.data('put', 'paid_period_overrides', { end: renewalEnd });
  await rt.data('reconciliationDue', testUid);
  const first = await until(async () => { const state = await rt.data('reconciliationState', testUid); return state.last_success_at && state; }, 'missed renewal recovery');
  const grant = await rt.data('read', `grant_${testUid}`);
  assert.equal(grant.active, true); assert.equal(grant.currentPeriodEnd, renewalEnd);
  assert.equal(first.attempts, 0); assert.equal(first.last_error, null);
  assert.equal(first.next_attempt_at - first.last_success_at, 6 * 60 * 60 * 1000);
  await rt.data('put', 'paid_period_overrides', { end: renewalEnd, amountRefunded: 900 });
  await rt.data('reconciliationDue', testUid);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at > first.last_success_at, 'missed refund recovery');
  assert.equal((await rt.data('read', `grant_${testUid}`)).active, false);
  assert.equal(await rt.data('read', 'calls_snapshot'), 2);
  const summary = await rt.data('summary');
  assert.equal(summary.pending, 0); assert.equal(summary.processed, 0);
  assert.deepEqual(summary.reconciliation, { customers: 1, due: 0, failing: 0, unfinished: 0, neverSucceeded: 0, nextDueAt: (await rt.data('reconciliationState', testUid)).next_attempt_at });
  assert.equal(JSON.stringify(summary).includes(testUid), false);
});
test('periodic failure and exponential backoff survive full runtime restart without busy retry', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('put', 'fail_projection', true);
  await rt.data('reconciliationDue', testUid);
  const first = await until(async () => { const row = await rt.data('reconciliationState', testUid); return row.last_error === 'processing_failed' && row; }, 'first periodic failure');
  assert.equal(first.attempts, 1); assert.ok(first.next_attempt_at >= Date.now() + 50_000);
  assert.equal(JSON.stringify(first).includes('example.invalid'), false);
  await rt.restart();
  assert.deepEqual(await rt.data('reconciliationState', testUid), first);
  assert.equal(await rt.data('read', 'calls_projection'), 1);
  await rt.data('reconciliationDue', testUid);
  const second = await until(async () => { const row = await rt.data('reconciliationState', testUid); return row.attempts === 2 && row.last_error === 'processing_failed' && row; }, 'second periodic failure');
  assert.ok(second.next_attempt_at >= Date.now() + 110_000);
  await rt.data('put', 'fail_projection', false); await rt.data('reconciliationDue', testUid);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at, 'periodic recovery after failures');
  assert.equal((await rt.data('reconciliationState', testUid)).attempts, 0);
  assert.equal((await rt.data('summary')).reconciliation.failing, 0);
});
test('post-projection periodic failure re-fetches new canonical state after restart', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('put', 'fail_reconciliation_save', true);
  await rt.data('reconciliationDue', testUid);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_error === 'simulated_reconciliation_storage_failure', 'post-projection periodic failure');
  assert.equal((await rt.data('read', `grant_${testUid}`)).active, true);
  await rt.restart();
  await rt.data('put', 'fail_reconciliation_save', false);
  await rt.data('put', 'paid_period_overrides', { amountRefunded: 900 });
  await rt.data('reconciliationDue', testUid);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at, 'fresh canonical retry');
  assert.equal((await rt.data('read', `grant_${testUid}`)).active, false);
  assert.equal(await rt.data('read', 'calls_snapshot'), 2);
});
test('periodic work shares the cancellable workflow deadline and retains its retry after restart', async t => {
  const rt = await runtime(t); await bind(rt);
  await rt.data('put', 'workflow_timeout_ms', 80); await rt.data('put', 'slow_snapshot', true);
  await rt.data('reconciliationDue', testUid);
  const failed = await until(async () => { const row = await rt.data('reconciliationState', testUid); return row.last_error === 'workflow_deadline_exceeded' && row; }, 'periodic deadline');
  assert.equal(failed.attempts, 1); assert.ok(failed.next_attempt_at >= Date.now() + 50_000);
  assert.equal(await rt.data('read', 'calls_projection', 0), 0);
  assert.deepEqual(await rt.data('read', 'operation_trace'), [`snapshot:${testUid}`, 'snapshot_slow:start', 'snapshot_slow:abort', 'snapshot_slow:settled']);
  await rt.restart(); assert.deepEqual(await rt.data('reconciliationState', testUid), failed);
  await rt.data('put', 'slow_snapshot', false); await rt.data('reconciliationDue', testUid);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at, 'periodic retry after cancellation');
  assert.equal((await rt.data('read', 'operation_trace')).includes('snapshot_slow:effect'), false);
});
test('disabled deployment preserves due customer state and re-enable resumes periodic recovery', async t => {
  const rt = await runtime(t); await bind(rt); await rt.restart(false);
  await rt.data('reconciliationDue', testUid);
  await new Promise(resolve => setTimeout(resolve, 100));
  const paused = await rt.data('reconciliationState', testUid);
  assert.equal(paused.attempts, 0); assert.equal(paused.last_success_at, null);
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
  assert.equal(await rt.data('alarmAt'), null);
  await rt.restart(true);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at, 'enabled periodic recovery');
  assert.equal(await rt.data('read', 'calls_projection'), 1);
});
test('existing bindings are backfilled after upgrade without touching newer due/retry state', async t => {
  const rt = await runtime(t); await bind(rt);
  await rt.data('removeReconciliationForUpgrade', testUid);
  assert.equal(await rt.data('reconciliationState', testUid), null);
  await rt.mf.unsafeEvictDurableObject('billing-local-test', 'FixtureLedger', { name: 'billing-v1-test' });
  const recovered = await rt.data('reconciliationState', testUid);
  assert.ok(recovered.next_attempt_at >= Date.now() + 50_000);
  assert.equal(await rt.data('alarmAt'), recovered.next_attempt_at);
  await rt.restart(); assert.deepEqual(await rt.data('reconciliationState', testUid), recovered);
});
test('five-item alarm batches alternate due queues fairly and retain the preference after restart', async t => {
  const rt = await runtime(t); await bind(rt);
  for (let index = 0; index < 5; index++) {
    await rt.data('reserveCustomer', `extra_${index}`, reservation());
    await rt.data('bindCustomer', `extra_${index}`, `cus_extra${index}`);
  }
  for (let index = 0; index < 8; index++) await rt.data('enqueue', envelope(`evt_batch${index}`));
  await rt.data('prepareBatch'); await rt.data('runAlarm');
  let summary = await rt.data('summary');
  assert.equal(summary.processed, 3); assert.equal(summary.reconciliation.neverSucceeded, 4);
  assert.equal(await rt.data('read', 'calls_snapshot'), 5);
  await rt.restart(); await rt.data('runAlarm');
  summary = await rt.data('summary');
  assert.equal(summary.processed, 5); assert.equal(summary.reconciliation.neverSucceeded, 1);
  assert.equal(await rt.data('read', 'calls_snapshot'), 10);
});

test('new webhook delivery cannot postpone an already-earlier alarm for due customer work', async t => {
  const rt = await runtime(t); await bind(rt);
  const alarmAt = Date.now() + 500;
  await rt.data('setReconciliationSchedule', testUid, Date.now() - 1, alarmAt);
  await rt.data('enqueue', envelope());
  assert.equal(await rt.data('alarmAt'), alarmAt);
  await until(async () => (await rt.data('reconciliationState', testUid)).last_success_at, 'unpostponed due customer work');
});


test('real scheduled event restores a lost alarm after restart without altering durable work or calling providers', async t => {
  const rt = await runtime(t); await bind(rt); await rt.data('enqueue', envelope());
  await rt.restart();
  // Simulate the durable alarm being lost while the restored object stays warm.
  await rt.data('prepareBatch');
  const customerBefore = await rt.data('reconciliationState', testUid);
  const eventBefore = await rt.data('eventState', 'evt_runtime');
  assert.equal(await rt.data('alarmAt'), null);
  const result = await (await rt.mf.getWorker()).scheduled({ cron: '0 * * * *' });
  assert.equal(result.outcome, 'ok');
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
  assert.deepEqual(await rt.data('reconciliationState', testUid), customerBefore);
  assert.deepEqual(await rt.data('eventState', 'evt_runtime'), eventBefore);
  assert.ok(await rt.data('alarmAt') > Date.now());
  await until(async () => (await rt.data('queuedEvent', 'evt_runtime')).processed && (await rt.data('reconciliationState', testUid)).last_success_at, 'rearmed normal alarm');
  assert.equal(await rt.data('read', 'calls_snapshot'), 2);
});
test('scheduled recovery preserves future backoff and does not manufacture an empty alarm', async t => {
  const rt = await runtime(t);
  assert.equal((await (await rt.mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
  assert.equal(await rt.data('alarmAt'), null);
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
  await bind(rt); await rt.data('put', 'fail_projection', true); await rt.data('reconciliationDue', testUid);
  const before = await until(async () => { const state = await rt.data('reconciliationState', testUid); return state.last_error === 'processing_failed' && state; }, 'durable periodic backoff');
  await rt.data('deleteAlarm');
  assert.equal((await (await rt.mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
  assert.deepEqual(await rt.data('reconciliationState', testUid), before);
  assert.equal(await rt.data('alarmAt'), before.next_attempt_at);
  assert.equal(await rt.data('read', 'calls_snapshot'), 1);
});
test('disabled real scheduled handler creates no object and cannot touch existing paused work', async t => {
  const rt = await runtime(t, false);
  assert.equal((await (await rt.mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
  assert.deepEqual(await rt.mf.listDurableObjectIds('FixtureLedger', 'billing-local-test'), []);
  await rt.restart(true); await bind(rt); await rt.data('prepareBatch');
  await rt.restart(false);
  // Constructor and all fixture reads are separate from the scheduled event.
  await rt.data('deleteAlarm');
  const before = await rt.data('reconciliationState', testUid);
  assert.equal((await (await rt.mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
  assert.deepEqual(await rt.data('reconciliationState', testUid), before);
  assert.equal(await rt.data('alarmAt'), null);
  assert.equal(await rt.data('read', 'calls_snapshot', 0), 0);
});

test('recovery window survives restart and cannot be reset by a later checkout',async t=>{
 const rt=await runtime(t);const now=Math.floor(Date.now()/1000);
 const offer={createdAt:now,expiresAt:now+172800,sourceSessionId:'cs_test_recovery'};
 assert.deepEqual(await rt.data('reserveRecoveryOffer',testUid,offer),offer);
 assert.deepEqual(await rt.data('reserveRecoveryOffer',testUid,{...offer,createdAt:now+60,expiresAt:now+172860}),offer);
 await rt.restart();assert.deepEqual(await rt.data('recoveryOffer',testUid),offer);
 for(const path of ['/internal/recovery-offers','/internal/recovery-eligible?uid='+testUid]){const r=await rt.mf.dispatchFetch('https://local.invalid'+path);assert.equal(r.status,401);}
});
test('regional public quote uses edge country, ignores caller country header, and has no cache',async t=>{
 const result=await build({entryPoints:[join(directory,'worker.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers','node:async_hooks']});
 const path=await mkdtemp(join(tmpdir(),'regional-quotes-'));
 const conf={...settings,regionalPricingEnabled:true,regionalOffers:{middle:{amount:1900,couponId:'mid'},value:{amount:1450,couponId:'val'}}};
 const mf=new Miniflare(options(path,true,result.outputFiles[0].text,'BillingLedger',conf));
 t.after(async()=>{await mf.dispose();await rm(path,{recursive:true,force:true});});
 for(const [country,amount] of [['US',2900],['ES',1900],['BR',1450],['TR',1450]]){
  const r=await mf.dispatchFetch('https://local.invalid/billing/market',{cf:{country},headers:{Origin:settings.appOrigin,'X-Internal-Market-Country':'BR'}});
  assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),settings.appOrigin);
  const q=await r.json();assert.equal(q.country,country);assert.equal(q.lifetime,amount);
 }
});

test('operator checkout attribution requires auth, validates uid, and is read only',async t=>{
 const rt=await runtime(t);
 const url='https://local.invalid/internal/checkout-attribution?uid='+testUid;
 assert.equal((await rt.mf.dispatchFetch(url)).status,401);
 const headers={Authorization:'Bearer fixture-feed'};
 assert.equal((await rt.mf.dispatchFetch(url,{method:'POST',headers})).status,405);
 assert.equal((await rt.mf.dispatchFetch('https://local.invalid/internal/checkout-attribution?uid=!',{headers})).status,400);
 const r=await rt.mf.dispatchFetch(url,{headers});assert.equal(r.status,200);assert.equal((await r.json()).found,false);
});
