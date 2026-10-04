import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SUPPORTED_EVENTS } from '../core.mjs';
import { STRIPE_API_VERSION } from '../providers/stripe.mjs';
import { privateDirectory as verifyPrivateDirectory, privateJson } from './runtime-sandbox-state.mjs';

export const SANDBOX_STRIPE_ACCOUNT = 'acct_1UKqIpJlJ2EM69u7';
export const SANDBOX_WORKER_ORIGIN = 'https://minimalpairs-billing-sandbox.sirmichealbingham.workers.dev';
const directory = path.dirname(fileURLToPath(import.meta.url));
const privateDirectory = path.resolve(directory, '../private');
const filename = path.join(privateDirectory, 'runtime-sandbox-stripe.json');
const webhookUrl = `${SANDBOX_WORKER_ORIGIN}/billing/webhook`;
const form = (value, prefix = '', result = new URLSearchParams()) => {
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}[${key}]` : key;
    if (child && typeof child === 'object') form(child, field, result);
    else if (child !== undefined) result.append(field, child === null ? '' : String(child));
  }
  return result;
};
export async function pinnedSandboxStripe() {
  verifyPrivateDirectory(privateDirectory);
  const credentials = privateJson(path.join(privateDirectory, 'stripe-sandbox.json'));
  assert.equal(credentials.accountId, SANDBOX_STRIPE_ACCOUNT); assert.equal(credentials.livemode, false);
  assert.match(credentials.secretKey, /^sk_test_[A-Za-z0-9]+$/);
  const request = async (method, endpoint, params = {}, key) => {
    assert.ok(['GET', 'POST', 'DELETE'].includes(method)); assert.match(endpoint, /^\/v1\/[A-Za-z0-9_/-]+$/);
    const url = new URL(endpoint, 'https://api.stripe.com'); const encoded = form(params).toString();
    if (method === 'GET') url.search = encoded;
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${credentials.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(method === 'POST' ? { body: encoded } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(`sandbox_stripe_http_${response.status}`);
    return data;
  };
  const account = await request('GET', '/v1/account'); assert.equal(account.id, SANDBOX_STRIPE_ACCOUNT); assert.equal(account.object, 'account');
  return { request, secretKey: credentials.secretKey };
}
export function readRuntimeStripeState() {
  const state = privateJson(filename);
  assert.equal(state.accountId, SANDBOX_STRIPE_ACCOUNT); assert.equal(state.livemode, false); assert.equal(state.webhookUrl, webhookUrl);
  return state;
}
function write(state) {
  if (fs.existsSync(filename)) privateJson(filename);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, filename);
}
async function main(mode) {
  verifyPrivateDirectory(privateDirectory);
  const lockfile = `${filename}.lock`, lock = fs.openSync(lockfile, 'wx', 0o600);
  try {
    const { request } = await pinnedSandboxStripe();
    let state;
    if (fs.existsSync(filename)) state = readRuntimeStripeState();
    else { assert.equal(mode, '--prepare'); state = { accountId: SANDBOX_STRIPE_ACCOUNT, livemode: false, webhookUrl, runId: randomUUID() }; write(state); }
    assert.match(state.runId, /^[a-f0-9-]{36}$/);
    if (mode === '--prepare') {
      assert.notEqual(state.retired, true, 'retired_webhook_requires_new_review');
      const fixture = privateJson(path.join(privateDirectory, 'stripe-probe-state.json'));
      assert.equal(fixture.accountId, SANDBOX_STRIPE_ACCOUNT); assert.equal(fixture.livemode, false);
      const prices = {};
      for (const [plan, amount, interval] of [['monthly', 900, 'month'], ['annual', 7900, 'year']]) {
        const p = fixture.operations[`price_${plan}`].result; assert.match(p.id, /^price_[A-Za-z0-9]+$/);
        const actual = await request('GET', `/v1/prices/${p.id}`);
        assert.equal(actual.livemode, false); assert.equal(actual.active, true); assert.equal(actual.currency, 'usd');
        assert.equal(actual.unit_amount, amount); assert.equal(actual.recurring.interval, interval); assert.equal(actual.recurring.interval_count, 1);
        prices[plan] = { id: p.id, unitAmount: amount, currency: 'usd', interval, intervalCount: 1 };
      }
      const portalId = fixture.operations.portal_config.result.id; assert.match(portalId, /^bpc_[A-Za-z0-9]+$/);
      const portal = await request('GET', `/v1/billing_portal/configurations/${portalId}`);
      assert.equal(portal.livemode, false); assert.equal(portal.active, true); assert.equal(portal.features.subscription_update.enabled, false);
      assert.equal(portal.features.subscription_cancel.enabled, true); assert.equal(portal.features.subscription_cancel.mode, 'at_period_end');
      assert.equal(portal.features.subscription_cancel.proration_behavior, 'none'); assert.equal(portal.features.payment_method_update.enabled, true);
      state.config = { appOrigin: 'https://minimalpairs-billing-sandbox.web.app', expectedLivemode: false, prices, portalConfigurationId: portalId }; write(state);
      if (!state.webhook) {
        state.webhookAttemptAt ??= Date.now();
        assert.ok(Date.now() - state.webhookAttemptAt < 23 * 3600000, 'uncertain_webhook_requires_readback_review'); write(state);
        const hook = await request('POST', '/v1/webhook_endpoints', { url: webhookUrl, api_version: STRIPE_API_VERSION,
          enabled_events: [...SUPPORTED_EVENTS], connect: false, description: 'MinimalPairs isolated runtime QA; synthetic data only',
          metadata: { rescueRuntimeProbe: state.runId } }, `runtime-sandbox-webhook:${state.runId}`);
        assert.match(hook.id, /^we_[A-Za-z0-9]+$/); assert.equal(hook.livemode, false); assert.equal(hook.url, webhookUrl);
        assert.match(hook.secret, /^whsec_[A-Za-z0-9]+$/);
        state.webhook = { id: hook.id, secret: hook.secret }; write(state);
      }
      assert.match(state.webhook.id, /^we_[A-Za-z0-9]+$/);
      const hook = await request('GET', `/v1/webhook_endpoints/${state.webhook.id}`);
      assert.equal(hook.livemode, false); assert.equal(hook.url, webhookUrl); assert.equal(hook.status, 'enabled');
      assert.equal(hook.api_version, STRIPE_API_VERSION); assert.equal(hook.metadata.rescueRuntimeProbe, state.runId);
      assert.deepEqual([...hook.enabled_events].sort(), [...SUPPORTED_EVENTS].sort());
      console.log(JSON.stringify({ result: 'prepared', accountId: SANDBOX_STRIPE_ACCOUNT, webhookId: hook.id, url: webhookUrl, events: hook.enabled_events.length,
        privateCredentialsStored: true, workerDeploymentInspected: false }));
    } else {
      assert.match(state.webhook?.id || '', /^we_[A-Za-z0-9]+$/);
      const hook = await request('GET', `/v1/webhook_endpoints/${state.webhook.id}`);
      assert.equal(hook.livemode, false); assert.equal(hook.url, webhookUrl); assert.equal(hook.metadata.rescueRuntimeProbe, state.runId);
      if (hook.status !== 'disabled') {
        assert.equal(hook.status, 'enabled');
        if (!state.disableOperation || state.disableOperation.confirmed) state.disableOperation = { key: `runtime-sandbox-stop:${randomUUID()}`, startedAt: Date.now() };
        assert.ok(Date.now() - state.disableOperation.startedAt < 23 * 3600000, 'uncertain_disable_requires_readback_review'); write(state);
        const stopped = await request('POST', `/v1/webhook_endpoints/${hook.id}`, { disabled: true }, state.disableOperation.key);
        assert.equal(stopped.status, 'disabled');
      }
      const terminal = await request('GET', `/v1/webhook_endpoints/${hook.id}`);
      assert.equal(terminal.url, webhookUrl); assert.equal(terminal.livemode, false); assert.equal(terminal.status, 'disabled');
      if (state.disableOperation) state.disableOperation.confirmed = true;
      state.retired = true; write(state);
      console.log(JSON.stringify({ result: 'webhook_disabled', accountId: SANDBOX_STRIPE_ACCOUNT, webhookId: hook.id }));
    }
  } finally { fs.closeSync(lock); fs.unlinkSync(lockfile); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--prepare', '--disable-webhook'].includes(process.argv[2])) console.log('Use --prepare or --disable-webhook for the fixed general Stripe Sandbox only. No customer or payment is created.');
  else main(process.argv[2]).catch(error => { console.error(JSON.stringify({ error: /^sandbox_stripe_http_\d+$/.test(error.message) ? error.message : 'sandbox_stripe_setup_failed' })); process.exitCode = 1; });
}
