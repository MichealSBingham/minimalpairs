import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createRuntimeSandboxOperator, SANDBOX } from './runtime-sandbox-identity.mjs';
import { pinnedSandboxStripe, readRuntimeStripeState, SANDBOX_WORKER_ORIGIN } from './runtime-sandbox-stripe.mjs';
import { createStripeAdapter } from '../providers/stripe.mjs';
import { privateDirectory as verifyPrivateDirectory, privateJson } from './runtime-sandbox-state.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const privateDirectory = path.resolve(directory, '../private');
const stateFile = path.join(privateDirectory, 'deployed-sandbox-flow.json');
const reportFile = path.resolve(directory, '../../qa/deployed-sandbox-flow-2026-09-30.json');
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--deployment-files', '--checkout', '--paid', '--refund', '--revoked', '--cancel', '--disable-user'].includes(mode)) {
  console.log('Fixed isolated Sandbox only: --deployment-files, --checkout, --paid, --refund, --revoked, --cancel, --disable-user. Tokens/keys/session URLs never printed.');
  process.exit(0);
}
verifyPrivateDirectory(privateDirectory);
const lockfile = `${stateFile}.lock`, lock = fs.openSync(lockfile, 'wx', 0o600);
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {
  project: SANDBOX.project, stripeAccountId: SANDBOX.stripeAccount, worker: SANDBOX_WORKER_ORIGIN,
  createdAt: new Date().toISOString(), checks: [], observations: [], realMoneyMoved: false, emailSendActions: 0,
};
let state;
const save = () => {
  if (fs.existsSync(stateFile)) privateJson(stateFile);
  const temporary = `${stateFile}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, stateFile);
};
const pass = check => { if (!report.checks.includes(check)) report.checks.push(check); };
const safeId = (value, prefix) => { assert.match(value || '', new RegExp(`^${prefix}_[A-Za-z0-9_]+$`)); return value; };
try {
  const identity = await createRuntimeSandboxOperator().refresh();
  const stripe = await pinnedSandboxStripe();
  const prepared = readRuntimeStripeState();
  assert.equal(prepared.retired, undefined); assert.equal(identity.stripeAccountId, SANDBOX.stripeAccount); assert.equal(identity.projectId, SANDBOX.project);
  assert.match(identity.uid, /^runtime_[a-f0-9]{32}$/);
  if (fs.existsSync(stateFile)) state = privateJson(stateFile);
  else { assert.equal(mode, '--deployment-files'); state = { uid: identity.uid, project: SANDBOX.project, stripeAccount: SANDBOX.stripeAccount, runId: randomUUID(), requestId: randomUUID() }; save(); }
  assert.equal(state.uid, identity.uid); assert.equal(state.project, SANDBOX.project); assert.equal(state.stripeAccount, SANDBOX.stripeAccount);
  assert.match(state.runId, /^[a-f0-9-]{36}$/); assert.match(state.requestId, /^[a-f0-9-]{36}$/);
  const worker = async (endpoint, body, options = {}) => {
    assert.ok(['/billing/checkout', '/billing/checkout-status', '/billing/portal'].includes(endpoint));
    const start = performance.now();
    const response = await fetch(`${SANDBOX_WORKER_ORIGIN}${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
      headers: { Origin: options.origin || prepared.config.appOrigin, 'Content-Type': 'application/json',
        ...(options.unauthenticated ? {} : { Authorization: `Bearer ${identity.idToken}` }) }, body: JSON.stringify(body) });
    const data = await response.json(); return { status: response.status, data, elapsedMs: Math.round(performance.now() - start), cors: response.headers.get('access-control-allow-origin') };
  };
  if (mode === '--deployment-files') {
    const config = JSON.parse(fs.readFileSync(path.resolve(directory, '../wrangler.sandbox.jsonc'), 'utf8'));
    assert.equal(config.name, 'minimalpairs-billing-sandbox'); assert.equal(config.vars.FIREBASE_PROJECT_ID, SANDBOX.project);
    config.main = path.resolve(directory, '../runtime/worker.mjs'); config.workers_dev = true; config.preview_urls = false;
    config.vars.BILLING_SERVICE_ENABLED = 'true'; config.vars.BILLING_CHECKOUT_ENABLED = 'true'; config.vars.BILLING_COMMUNICATIONS_APPROVED = 'true';
    config.vars.BILLING_CONFIG_JSON = JSON.stringify(prepared.config);
    config.triggers = { crons: [] }; // bounded test; actual Durable Object alarms remain enabled
    const secrets = { STRIPE_SECRET_KEY: stripe.secretKey, STRIPE_ACCOUNT_ID: SANDBOX.stripeAccount,
      STRIPE_WEBHOOK_SECRETS_JSON: JSON.stringify([prepared.webhook.secret]), FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(identity.serviceCredentials) };
    assert.match(prepared.webhook.secret, /^whsec_[A-Za-z0-9]+$/);
    for (const [name, value] of [['wrangler.runtime-sandbox.json', config], ['runtime-sandbox-secrets.json', secrets]]) {
      const file = path.join(privateDirectory, name); if (fs.existsSync(file)) privateJson(file);
      const temp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file);
    }
    pass('isolated_runtime_configuration_prepared');
  } else if (mode === '--disable-user') {
    await createRuntimeSandboxOperator().disableUser();
    const rejected = await worker('/billing/checkout-status', {});
    assert.equal(rejected.status, 401); assert.equal(rejected.data.error, 'verified_account_required');
    pass('deployed_runtime_rejects_previously_valid_token_after_user_disabled');
  } else if (mode === '--checkout') {
    const wrong = await worker('/billing/checkout-status', {}, { origin: 'https://example.invalid' }); assert.equal(wrong.status, 403);
    const missing = await worker('/billing/checkout-status', {}, { unauthenticated: true }); assert.equal(missing.status, 401);
    const before = await worker('/billing/checkout-status', {}); assert.equal(before.status, 200); assert.ok(['none', 'open', 'pending'].includes(before.data.state));
    const body = { plan: 'monthly', requestId: state.requestId };
    state.checkoutAttemptAt ??= Date.now(); save();
    const results = await Promise.all([worker('/billing/checkout', body), worker('/billing/checkout', body)]);
    for (const r of results) { assert.equal(r.status, 200, 'sandbox_checkout_failed'); assert.equal(r.cors, prepared.config.appOrigin); assert.equal(new URL(r.data.url).origin, 'https://checkout.stripe.com'); }
    assert.equal(results[0].data.url, results[1].data.url, 'duplicate_checkout_created');
    state.checkoutUrl = results[0].data.url; state.checkoutId = safeId(new URL(state.checkoutUrl).pathname.split('/').at(-1), 'cs'); save();
    const after = await worker('/billing/checkout-status', {}); assert.equal(after.status, 200); assert.equal(after.data.state, 'open'); assert.equal(after.data.requestId, state.requestId);
    pass('deployed_origin_authentication_and_fresh_identity'); pass('concurrent_deployed_checkouts_reuse_one_session'); pass('deployed_canonical_checkout_status');
    report.observations.push({ at: new Date().toISOString(), phase: 'checkout', status: after.data.state, elapsedMs: results.map(r => r.elapsedMs) });
  } else {
    safeId(state.checkoutId, 'cs');
    const adapter = createStripeAdapter({ secretKey: stripe.secretKey, expectedAccountId: SANDBOX.stripeAccount, expectedLivemode: false, prices: prepared.config.prices });
    const checkout = await adapter.retrieveCheckoutSession(state.checkoutId);
    assert.equal(checkout.client_reference_id, identity.uid); assert.equal(checkout.status, 'complete'); assert.equal(checkout.mode, 'subscription');
    const binding = { uid: identity.uid, customerId: checkout.customer };
    const snapshot = await adapter.currentSubscriptionSnapshot(binding); assert.equal(snapshot.subscriptionId, checkout.subscription);
    state.customerId = safeId(checkout.customer, 'cus'); state.subscriptionId = safeId(checkout.subscription, 'sub'); save();
    if (mode === '--refund') {
      assert.equal(snapshot.paidPeriods.length, 1); const period = snapshot.paidPeriods[0]; assert.equal(period.amountPaid, 900);
      const payments = await stripe.request('GET', '/v1/invoice_payments', { invoice: safeId(period.invoiceId, 'in'), limit: 100 });
      assert.equal(payments.has_more, false); assert.equal(payments.data.length, 1); const payment = payments.data[0];
      assert.equal(payment.invoice, period.invoiceId); assert.equal(payment.payment.type, 'payment_intent');
      const intent = await stripe.request('GET', `/v1/payment_intents/${safeId(payment.payment.payment_intent, 'pi')}`);
      assert.equal(intent.livemode, false); assert.equal(intent.customer, state.customerId); assert.equal(intent.amount_received, 900);
      const charge = await stripe.request('GET', `/v1/charges/${safeId(intent.latest_charge, 'ch')}`);
      assert.equal(charge.livemode, false); assert.equal(charge.customer, state.customerId); assert.equal(charge.payment_intent, intent.id);
      if (!state.refundId) {
        state.refundAttemptAt ??= Date.now(); assert.ok(Date.now() - state.refundAttemptAt < 23 * 3600000); save();
        const refund = await stripe.request('POST', '/v1/refunds', { charge: charge.id, amount: 900 }, `runtime-refund:${state.runId}`);
        assert.equal(refund.charge, charge.id); assert.equal(refund.status, 'succeeded'); state.refundId = safeId(refund.id, 're'); save();
      }
      const confirmed = await stripe.request('GET', `/v1/refunds/${safeId(state.refundId, 're')}`);
      assert.equal(confirmed.charge, charge.id); assert.equal(confirmed.amount, 900); assert.equal(confirmed.status, 'succeeded');
      pass('isolated_runtime_payment_fully_test_refunded');
    } else if (mode === '--cancel') {
      if (snapshot.status !== 'canceled') await stripe.request('DELETE', `/v1/subscriptions/${state.subscriptionId}`);
      const canceled = await stripe.request('GET', `/v1/subscriptions/${state.subscriptionId}`);
      assert.equal(canceled.livemode, false); assert.equal(canceled.customer, state.customerId); assert.equal(canceled.status, 'canceled');
      pass('isolated_runtime_test_subscription_canceled');
    } else {
      const require = createRequire(import.meta.url); const auth = require(path.resolve(directory, '../../app/node_modules/firebase-tools/lib/auth.js'));
      const owner = auth.getProjectDefaultAccount(path.resolve(directory, '../../app')); const token = await auth.getAccessToken(owner.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
      const response = await fetch(`https://firestore.googleapis.com/v1/projects/${SANDBOX.project}/databases/(default)/documents/entitlements/${identity.uid}`, {
        headers: { Authorization: `Bearer ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, 'sandbox_entitlement_not_yet_written'); const doc = await response.json(); const f = doc.fields;
      assert.equal(f.customerId.stringValue, state.customerId); assert.equal(f.subscriptionId.stringValue, state.subscriptionId);
      assert.equal(f.plan.stringValue, 'monthly'); assert.equal(Number(f.schemaVersion.integerValue), 1);
      assert.equal(f.active.booleanValue, mode === '--paid', 'sandbox_entitlement_not_yet_reconciled');
      assert.equal(f.reason.stringValue, mode === '--paid' ? 'paid_period' : 'no_current_paid_coverage');
      if (mode === '--paid') {
        const end = Number(f.currentPeriodEnd.integerValue);
        assert.ok(Number.isSafeInteger(end) && end > Date.now() / 1000 && end <= snapshot.currentPeriodEnd, 'sandbox_paid_period_invalid');
      }
      report.observations.push({ at: new Date().toISOString(), phase: mode.slice(2), projectedActive: f.active.booleanValue,
        reason: f.reason.stringValue, currentPeriodEnd: Number(f.currentPeriodEnd.integerValue), updatedAt: Number(f.updatedAt.integerValue) });
      pass(mode === '--paid' ? 'actual_deployed_runtime_grants_firestore_paid_access' : 'actual_deployed_runtime_revokes_firestore_access_after_refund');
      const status = await worker('/billing/checkout-status', {}); assert.equal(status.status, 200); assert.equal(status.data.state, 'existing_subscription');
      if (mode === '--paid') {
        const duplicate = await worker('/billing/checkout', { plan: 'monthly', requestId: randomUUID() }); assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error, 'existing_subscription_use_portal');
        const portal = await worker('/billing/portal', {}); assert.equal(portal.status, 200); assert.equal(new URL(portal.data.url).origin, 'https://billing.stripe.com');
        state.portalUrl = portal.data.url; save(); pass('deployed_duplicate_purchase_block_and_portal');
      }
    }
  }
  report.lastResult = 'passed'; report.lastPhase = mode.slice(2); delete report.error;
  report.updatedAt = new Date().toISOString(); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: mode, result: 'passed', checks: report.checks }));
} catch (error) {
  const message = error.message || ''; const code = /^[a-z_]{1,100}$/.test(message) ? message : 'sandbox_runtime_check_failed';
  report.lastResult = 'failed'; report.lastPhase = mode.slice(2); report.error = code; report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); console.error(JSON.stringify({ phase: mode, result: 'failed', code })); process.exitCode = 1;
} finally { fs.closeSync(lock); fs.unlinkSync(lockfile); }
