import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStripeAdapter, STRIPE_API_VERSION } from '../providers/stripe.mjs';
import { checkoutParameters, subscriptionEntitlement } from '../core.mjs';

// Operator-only, synthetic card-only probe. Never imported by the app/Worker.
// This general Sandbox has separate settings and data; no live account fallback.
const ACCOUNT = 'acct_1UKqIpJlJ2EM69u7';
const directory = path.dirname(fileURLToPath(import.meta.url));
const privateDirectory = path.resolve(directory, '../private');
const statePath = path.join(privateDirectory, 'stripe-probe-state.json');
const reportPath = path.resolve(directory, '../../qa/stripe-sandbox-provider-probe-2026-09-28.json');
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--prepare', '--inspect', '--cancel', '--refund', '--cleanup'].includes(mode)) {
  console.log('Use --prepare, --inspect, --cancel, --refund or --cleanup. Exact isolated Stripe Sandbox; synthetic identities only.');
  process.exit(0);
}
fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(privateDirectory, 0o700);
const lockPath = path.join(privateDirectory, 'stripe-probe.lock');
const lock = fs.openSync(lockPath, 'wx', 0o600);
let state;
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {
  accountId: ACCOUNT, livemode: false, apiVersion: STRIPE_API_VERSION, startedAt: new Date().toISOString(),
  scope: 'Actual Stripe provider and core projection from local process; not deployed Worker, webhook delivery or real revenue.',
  communications: { syntheticInvalidEmailOnly: true, noManualSends: true, noReceiptEmailOverride: true, cardOnly: true,
    successfulPaymentAndRefundEmailsOff: true, renewalAndDunningEmailsOff: true, finalizedInvoicesAndCreditNotesOff: true },
  checks: [], observations: [],
};
const save = () => {
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, statePath);
};
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); };
const id = (value, prefix) => { assert.match(value || '', new RegExp(`^${prefix}_[A-Za-z0-9]+$`)); return value; };
const form = (value, prefix = '', result = new URLSearchParams()) => {
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}[${key}]` : key;
    if (child && typeof child === 'object') form(child, field, result);
    else if (child !== undefined) result.append(field, child === null ? '' : String(child));
  }
  return result;
};
try {
  const credentials = JSON.parse(fs.readFileSync(path.join(privateDirectory, 'stripe-sandbox.json'), 'utf8'));
  assert.equal(credentials.accountId, ACCOUNT); assert.equal(credentials.livemode, false);
  assert.match(credentials.secretKey, /^sk_test_[A-Za-z0-9]+$/);
  const request = async (method, endpoint, body, key) => {
    assert.ok(['GET', 'POST', 'DELETE'].includes(method));
    assert.match(endpoint, /^\/v1\/[A-Za-z0-9_/-]+$/);
    const url = new URL(endpoint, 'https://api.stripe.com');
    const encoded = form(body || {}).toString();
    if (method === 'GET') url.search = encoded;
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${credentials.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}) }, ...(method === 'POST' ? { body: encoded } : {}) });
    const data = await response.json();
    if (!response.ok) {
      const safe = value => /^[A-Za-z0-9_.\[\]-]{1,100}$/.test(value || '') ? value : 'unspecified';
      throw new Error(`stripe_probe_http_${response.status}_${safe(data.error?.code)}_${safe(data.error?.param)}`);
    }
    return data;
  };
  const account = await request('GET', '/v1/account');
  assert.equal(account.id, ACCOUNT); assert.equal(account.object, 'account');
  pass('exact_general_sandbox_account_and_test_key');
  if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  else {
    assert.equal(mode, '--prepare');
    state = { accountId: ACCOUNT, livemode: false, runId: randomUUID(), uid: `stripe_probe_${randomUUID().replaceAll('-', '')}`, operations: {} };
    save();
  }
  assert.equal(state.accountId, ACCOUNT); assert.equal(state.livemode, false);
  assert.match(state.runId, /^[a-f0-9-]{36}$/); assert.match(state.uid, /^stripe_probe_[a-f0-9]{32}$/);
  const mutate = async (name, fn) => {
    if (state.operations[name]?.result) return state.operations[name].result;
    const operation = state.operations[name] || { startedAt: Date.now(), key: `minimalpairs-sandbox:${state.runId}:${name}` };
    // Do not create duplicate resources after Stripe's idempotency retention.
    assert.ok(Date.now() - operation.startedAt < 23 * 60 * 60 * 1000, 'uncertain_operation_requires_readback_review');
    state.operations[name] = operation; save();
    operation.result = await fn(operation.key); save();
    return operation.result;
  };
  if (mode === '--prepare') {
    const product = await mutate('product', async key => {
      const p = await request('POST', '/v1/products', { name: 'MinimalPairs QA membership — TEST ONLY', metadata: { rescueProbe: state.runId } }, key);
      assert.equal(p.livemode, false); return { id: id(p.id, 'prod') };
    });
    for (const [plan, amount, interval] of [['monthly', 900, 'month'], ['annual', 7900, 'year']]) {
      await mutate(`price_${plan}`, async key => {
        const p = await request('POST', '/v1/prices', { product: id(product.id, 'prod'), currency: 'usd', unit_amount: amount,
          recurring: { interval, interval_count: 1, usage_type: 'licensed' }, metadata: { rescueProbe: state.runId } }, key);
        assert.equal(p.livemode, false); assert.equal(p.unit_amount, amount); assert.equal(p.recurring.interval, interval);
        return { id: id(p.id, 'price'), unitAmount: amount, currency: 'usd', interval, intervalCount: 1 };
      });
    }
    await mutate('portal_config', async key => {
      const p = await request('POST', '/v1/billing_portal/configurations', { name: 'MinimalPairs QA — TEST ONLY',
        default_return_url: 'https://minimalpairs-billing-sandbox.web.app/account', login_page: { enabled: false },
        features: { customer_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
          subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' } },
        metadata: { rescueProbe: state.runId } }, key);
      assert.equal(p.livemode, false); return { id: id(p.id, 'bpc') };
    });
    pass('test_product_prices_and_cancel_only_portal_created');
  }
  const prices = Object.fromEntries(['monthly', 'annual'].map(plan => [plan, state.operations[`price_${plan}`]?.result]));
  const config = { appOrigin: 'https://minimalpairs-billing-sandbox.web.app', expectedLivemode: false,
    serviceEnabled: true, checkoutEnabled: true, communicationsApproved: true, prices };
  // This local-only test flag covers a synthetic nonsending flow; production flags remain false.
  const adapter = createStripeAdapter({ secretKey: credentials.secretKey, expectedAccountId: ACCOUNT, expectedLivemode: false, prices });
  if (mode === '--prepare') {
    const customer = await mutate('customer', key => adapter.createCustomer({ email: `${state.uid}@example.invalid`,
      metadata: { firebaseUid: state.uid, billingSchema: '1' } }, key));
    const session = await mutate('checkout', key => adapter.createCheckoutSession(checkoutParameters(config, { uid: state.uid }, customer.id, 'monthly'), key));
    assert.equal(session.status, 'open');
    const reread = await adapter.retrieveCheckoutSession(session.id); assert.equal(reread.id, session.id); assert.equal(reread.status, 'open');
    await mutate('portal_session', key => adapter.createPortalSession({ customer: customer.id,
      configuration: state.operations.portal_config.result.id, return_url: `${config.appOrigin}/account` }, key));
    pass('real_adapter_customer_checkout_readback_and_portal');
    // Checkout/portal URLs stay in private state, never in the public QA report.
  } else {
    const customerId = id(state.operations.customer.result.id, 'cus');
    const binding = { uid: state.uid, customerId };
    const checkout = await adapter.retrieveCheckoutSession(state.operations.checkout.result.id);
    const customer = await adapter.retrieveCustomer(customerId);
    assert.equal(customer.metadata.firebaseUid, state.uid, 'probe_customer_uid_mismatch');
    assert.equal(customer.metadata.billingSchema, '1', 'probe_customer_schema_mismatch');
    assert.equal(checkout.customer, customerId, 'probe_checkout_customer_mismatch');
    assert.equal(checkout.client_reference_id, state.uid, 'probe_checkout_uid_mismatch');
    assert.equal(checkout.status, 'complete', 'complete_hosted_test_checkout_before_inspect');
    assert.equal(checkout.mode, 'subscription', 'probe_checkout_mode_mismatch');
    const subscriptions = await adapter.listAllSubscriptions(customerId);
    assert.equal(subscriptions.length, 1, 'complete_hosted_test_checkout_before_inspect');
    const subscriptionId = id(subscriptions[0].id, 'sub');
    assert.equal(checkout.subscription, subscriptionId, 'probe_checkout_subscription_mismatch');
    // Validate the full account/customer/UID/payment graph before any mutation.
    await adapter.currentSubscriptionSnapshot(binding);
    // --cancel verifies the real hosted portal action; it cannot manufacture that evidence.
    if (mode === '--cancel') await mutate('cancel_at_end', async () => {
      const sub = await request('GET', `/v1/subscriptions/${subscriptionId}`);
      assert.equal(sub.livemode, false); assert.equal(sub.customer, customerId);
      assert.ok(sub.cancel_at_period_end === true || sub.cancel_at === sub.items.data[0].current_period_end, 'portal_cancellation_not_scheduled');
      return { id: sub.id, cancelAtPeriodEnd: sub.cancel_at_period_end, cancelAt: sub.cancel_at };
    });
    if (mode === '--refund') await mutate('refund', async key => {
      const charges = await request('GET', '/v1/charges', { customer: customerId, limit: 100 });
      assert.equal(charges.has_more, false); assert.equal(charges.data.length, 1);
      const c = charges.data[0]; assert.equal(c.livemode, false); assert.equal(c.customer, customerId); assert.equal(c.amount, 900);
      const refund = await request('POST', '/v1/refunds', { charge: id(c.id, 'ch'), amount: 900 }, key);
      assert.equal(refund.charge, c.id); assert.equal(refund.status, 'succeeded'); return { id: id(refund.id, 're'), amount: refund.amount };
    });
    if (mode === '--cleanup') await mutate('cancel_now', async () => {
      const sub = await request('DELETE', `/v1/subscriptions/${subscriptionId}`);
      assert.equal(sub.livemode, false); assert.equal(sub.customer, customerId); assert.equal(sub.status, 'canceled');
      return { id: sub.id, status: sub.status };
    });
    const snapshot = await adapter.currentSubscriptionSnapshot(binding);
    const projection = subscriptionEntitlement(snapshot, binding, config, Math.floor(Date.now() / 1000));
    report.observations.push({ at: new Date().toISOString(), phase: mode.slice(2), checkoutStatus: checkout.status,
      subscriptionStatus: snapshot.status, cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      cancelAt: snapshot.cancelAt, currentPeriodEnd: snapshot.currentPeriodEnd,
      paidPeriods: snapshot.paidPeriods.map(p => ({ amountPaid: p.amountPaid, amountRefunded: p.amountRefunded, disputeStatus: p.disputeStatus })),
      projectedActive: projection.active, projectedReason: projection.reason });
    assert.equal(checkout.status, 'complete');
    if (mode === '--inspect' && !state.operations.refund?.result && !state.operations.cancel_now?.result) {
      assert.equal(projection.active, true); pass('real_hosted_checkout_paid_invoice_charge_and_active_projection');
    }
    if (mode === '--cancel') { assert.ok(snapshot.cancelAtPeriodEnd || snapshot.cancelAt === snapshot.currentPeriodEnd); assert.equal(projection.active, true); pass('hosted_portal_cancellation_preserves_paid_access_until_end'); }
    if (mode === '--refund') { assert.equal(projection.active, false); assert.equal(projection.reason, 'no_current_paid_coverage'); pass('full_test_refund_revokes_paid_access'); }
    if (mode === '--cleanup') { assert.equal(snapshot.status, 'canceled'); assert.equal(projection.active, false); pass('test_subscription_canceled_no_future_renewal'); }
  }
  delete report.error;
  report.lastResult = 'passed'; report.lastPhase = mode.slice(2); report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: mode, result: 'passed', checks: report.checks, report: reportPath }));
} catch (error) {
  const code = /^[A-Za-z0-9_.\[\]-]{1,180}$/.test(error.message || '') ? error.message : 'probe_assertion_failed';
  report.lastResult = 'failed'; report.lastPhase = mode.slice(2); report.error = code; report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ result: 'failed', code })); process.exitCode = 1;
} finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
