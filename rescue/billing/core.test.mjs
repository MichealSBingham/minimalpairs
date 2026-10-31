import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { recoveryParameters, BillingError, requireVerifiedAccount, checkoutParameters, sameCheckoutParameters, createBillingHandler, verifyStripeEvent, subscriptionEntitlement, processQueuedEvent, reconcileBoundCustomer } from './core.mjs';

const NOW = 1_800_000_000;
const secret = 'whsec_syntheticOnlyNeverARealSecret';
const requestId = '46b164d4-cc4f-42ab-8a61-e63573d52b85';
const secondRequestId = 'd565baec-94d3-4c83-9b16-d7f69de4d6c8';
const account = { uid: 'synthetic_uid', email: 'TESTER@example.invalid', emailVerified: true, serverVerified: true };
const config = () => ({
  serviceEnabled: true, checkoutEnabled: true, communicationsApproved: true, expectedLivemode: false,
  appOrigin: 'https://minimalpairs.co', webhookSecrets: [secret], portalConfigurationId: 'bpc_synthetic',
  prices: {
    monthly: { id: 'price_monthly', currency: 'usd', interval: 'month', intervalCount: 1 },
    annual: { id: 'price_annual', currency: 'usd', interval: 'year', intervalCount: 1 },
  },
});
const binding = { uid: account.uid, customerId: 'cus_synthetic' };
const customer = () => ({ id: binding.customerId, livemode: false, metadata: { firebaseUid: account.uid } });
const checkout = () => ({ id: 'cs_test_synthetic', mode: 'subscription', status: 'open', customer: binding.customerId, livemode: false,
  client_reference_id: account.uid, url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic' });
const paidPeriod = () => ({ invoiceId: 'in_synthetic', subscriptionId: 'sub_synthetic', priceId: 'price_monthly',
  invoiceStatus: 'paid', successfulCharge: true, amountPaid: 900, amountRefunded: 0, disputeStatus: 'none',
  currency: 'usd', start: NOW - 10_000, end: NOW + 10_000 });
const snapshot = () => ({ ...binding, livemode: false, subscriptionId: 'sub_synthetic', priceId: 'price_monthly',
  status: 'active', itemCount: 1, quantity: 1, currency: 'usd', interval: 'month', intervalCount: 1,
  currentPeriodStart: NOW - 10_000, currentPeriodEnd: NOW + 10_000, paidPeriods: [paidPeriod()] });

function fixture() {
  const settings = config();
  const state = { calls: [], customerId: null, customerReservation: null, pending: null, subscriptions: [], grant: null, queued: new Map(), projected: [], completed: [] };
  const record = (name, ...args) => state.calls.push({ name, args });
  const ports = {
    auth: { async verifyIdToken(token) { record('verify', token); return { ...account }; } },
    async legacyEntitlement(email) { record('legacy', email); return state.grant; },
    billing: {
      async runExclusive(uid, action) { record('lock', uid); return action(); },
      async customerForUid(uid) { record('customerForUid', uid); return state.customerId; },
      async reserveCustomer(uid, proposed) { record('reserveCustomer', uid); return state.customerReservation ??= structuredClone(proposed); },
      async bindCustomer(uid, id) { record('bindCustomer', uid, id); state.customerId = id; },
      async pendingCheckout() { return structuredClone(state.pending); },
      async savePendingCheckout(uid, pending) { record('savePending', uid, structuredClone(pending)); state.pending = structuredClone(pending); },
      async retirePendingCheckout(uid, sessionId) { record('retirePending', uid, sessionId); if (state.pending?.sessionId === sessionId) state.pending = null; },
      async enqueue(event) { record('enqueue', event); if (!state.queued.has(event.eventId)) state.queued.set(event.eventId, { event, processed: false }); },
      async runProcessingExclusive(action) { record('processLock'); return action(); },
      async queuedEvent(id) { return state.queued.get(id); },
      async resolveEventBinding(event) { record('resolveBinding', event); return binding; },
      async markProcessed(id, data) { record('markProcessed', id); state.queued.get(id).processed = true; state.completed.push(data); },
    },
    stripe: {
      async createCustomer(params, key) { record('createCustomer', params, key); return customer(); },
      async retrieveCustomer(id) { record('retrieveCustomer', id); return customer(); },
      async listAllSubscriptions(id) { record('subscriptions', id); return state.subscriptions; },
      async createCheckoutSession(params, key) { record('createCheckout', params, key); return checkout(); },
      async retrieveCheckoutSession(id) { record('retrieveCheckout', id); return checkout(); },
      async createPortalSession(params) { record('createPortal', params); return { url: 'https://billing.stripe.com/p/session/synthetic' }; },
      async currentSubscriptionSnapshot(owner) { record('snapshot', owner); return snapshot(); },
    },
    entitlements: { async projectSubscription(uid, data) { record('project', uid); state.projected.push({ uid, data }); } },
  };
  return { config: settings, state, ports, handler: createBillingHandler(settings, ports) };
}
function request(path = '/billing/checkout', body = { plan: 'monthly', requestId }, headers = {}) {
  return new Request(`https://billing.example.invalid${path}`, { method: 'POST',
    headers: { Origin: 'https://minimalpairs.co', Authorization: 'Bearer synthetic.server.verified.token', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body) });
}
async function result(response) { return { status: response.status, body: await response.json() }; }
function event(overrides = {}) { return { id: 'evt_synthetic', type: 'invoice.paid', created: NOW, livemode: false,
  data: { object: { id: 'in_synthetic', customer_email: 'synthetic@example.invalid', amount_paid: 900 } }, ...overrides }; }
function signed(value = event(), timestamp = NOW, signingSecret = secret) {
  const raw = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = createHmac('sha256', signingSecret).update(`${timestamp}.`).update(raw).digest('hex');
  return { raw, header: `t=${timestamp},v1=${digest}` };
}

test('explicit checkout status is authenticated, same-origin and cannot accept a customer or session from the browser', async () => {
  for (const headers of [{ Origin: 'https://other.invalid' }, { Authorization: '' }]) {
    const f = fixture(); const r = await f.handler(request('/billing/checkout-status', {}, headers));
    assert.ok([401, 403].includes(r.status)); assert.equal(f.state.calls.some(c => c.name === 'createCheckout'), false);
  }
  const f = fixture();
  assert.equal((await f.handler(request('/billing/checkout-status', { sessionId: 'cs_other' }))).status, 400);
  assert.equal((await f.handler(request('/billing/checkout-status', { customerId: 'cus_other' }))).status, 400);
  f.config.serviceEnabled = false;
  assert.equal((await f.handler(request('/billing/checkout-status', {}))).status, 503);
});

test('checkout status without a reservation is side-effect free, and lifetime status never contacts Stripe', async () => {
  const f = fixture(); f.config.checkoutEnabled = false;
  assert.deepEqual(await result(await f.handler(request('/billing/checkout-status', {}))), { status: 200, body: { state: 'none' } });
  assert.equal(f.state.calls.some(c => ['reserveCustomer', 'createCustomer', 'createCheckout', 'createPortal', 'savePending', 'retirePending'].includes(c.name)), false);
  f.state.grant = { active: true, plan: 'lifetime' }; f.state.customerId = binding.customerId; f.state.calls.length = 0;
  assert.deepEqual(await result(await f.handler(request('/billing/checkout-status', {}))), { status: 200, body: { state: 'lifetime' } });
  assert.equal(f.state.calls.some(c => ['retrieveCustomer', 'listSubscriptions', 'retrieveCheckout', 'createCheckout', 'retirePending'].includes(c.name)), false);
});

test('open and uncertain checkout status preserve the canonical request and never create another session', async () => {
  for (const state of ['open', 'complete', 'unknown-id']) {
    const f = fixture(); await f.handler(request());
    if (state === 'unknown-id') delete f.state.pending.sessionId;
    else f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: state });
    const pending = structuredClone(f.state.pending); f.state.calls.length = 0;
    const r = await result(await f.handler(request('/billing/checkout-status', {})));
    assert.deepEqual(r, { status: 200, body: { state: state === 'open' ? 'open' : 'pending', plan: 'monthly', requestId, createdAt: pending.createdAt } });
    assert.deepEqual(f.state.pending, pending);
    assert.equal(f.state.calls.some(c => ['createCheckout', 'createCustomer', 'retirePending'].includes(c.name)), false);
    assert.equal(f.state.projected.length, 0);
  }
});

test('only provider-confirmed expiration retires the exact reservation and allows a different later plan', async () => {
  const f = fixture(); await f.handler(request()); f.state.calls.length = 0;
  f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'expired', url: null });
  assert.deepEqual(await result(await f.handler(request('/billing/checkout-status', {}))), { status: 200, body: { state: 'none' } });
  assert.equal(f.state.pending, null);
  assert.deepEqual(f.state.calls.find(c => c.name === 'retirePending').args, [account.uid, 'cs_test_synthetic']);
  assert.equal(f.state.calls.some(c => c.name === 'createCheckout'), false);
  assert.equal((await f.handler(request('/billing/checkout', { plan: 'annual', requestId: secondRequestId }))).status, 200);
  assert.equal(f.state.pending.plan, 'annual');
});

test('wrong checkout scope, provider failure and failed retirement never clear an uncertain reservation', async () => {
  for (const change of [{ id: 'cs_other' }, { customer: 'cus_other' }, { client_reference_id: 'another_uid' }, { livemode: true }, { mode: 'payment' }, { status: 'unknown' }]) {
    const f = fixture(); await f.handler(request()); const before = structuredClone(f.state.pending);
    f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'expired', ...change });
    assert.equal((await f.handler(request('/billing/checkout-status', {}))).status, 502); assert.deepEqual(f.state.pending, before);
  }
  for (const failure of ['provider', 'retirement']) {
    const f = fixture(); await f.handler(request()); const before = structuredClone(f.state.pending);
    f.ports.stripe.retrieveCheckoutSession = async () => { if (failure === 'provider') throw Error('private'); return { ...checkout(), status: 'expired' }; };
    f.ports.billing.retirePendingCheckout = async () => {};
    assert.notEqual((await f.handler(request('/billing/checkout-status', {}))).status, 200); assert.deepEqual(f.state.pending, before);
  }
});

test('existing subscription state directs billing management without representing paid access or retiring checkout', async () => {
  for (const status of ['active', 'past_due', 'incomplete', 'unpaid', 'paused']) {
    const f = fixture(); await f.handler(request()); f.state.subscriptions = [{ status }]; f.state.calls.length = 0;
    assert.deepEqual(await result(await f.handler(request('/billing/checkout-status', {}))), { status: 200, body: { state: 'existing_subscription' } });
    assert.equal(f.state.projected.length, 0); assert.ok(f.state.pending);
    assert.equal(f.state.calls.some(c => c.name === 'retirePending'), false);
  }
});
async function rejectCode(promise, code) { await assert.rejects(promise, error => error instanceof BillingError && error.code === code); }

test('checked-in example is disabled, empty, and cannot reach provider adapters', async () => {
  const example = JSON.parse(await readFile(new URL('./config.example.json', import.meta.url)));
  assert.equal(example.serviceEnabled, false); assert.equal(example.checkoutEnabled, false); assert.equal(example.communicationsApproved, false);
  assert.deepEqual(example.webhookSecrets, []); assert.equal(example.prices.monthly.id, '');
  const response = await createBillingHandler(example, {})(request());
  assert.deepEqual(await result(response), { status: 503, body: { error: 'billing_not_enabled' } });
});
test('only a trusted verified account is accepted; email aliases remain distinct', () => {
  assert.deepEqual(requireVerifiedAccount({ ...account, email: ' Name+plus@Example.invalid ' }), { uid: account.uid, email: 'name+plus@example.invalid' });
  for (const change of [{ emailVerified: false }, { serverVerified: false }, { uid: '../another' }, { email: 'bad' }]) {
    assert.throws(() => requireVerifiedAccount({ ...account, ...change }), /verified_account_required/);
  }
});
test('origin, authentication and disabled communications stop checkout before money APIs', async () => {
  for (const mode of ['foreignOrigin', 'noBearer', 'unverified', 'notApproved']) {
    const f = fixture();
    const headers = mode === 'foreignOrigin' ? { Origin: 'https://attacker.invalid' } : mode === 'noBearer' ? { Authorization: '' } : {};
    if (mode === 'unverified') f.ports.auth.verifyIdToken = async () => ({ ...account, emailVerified: false });
    if (mode === 'notApproved') f.config.communicationsApproved = false;
    const response = await f.handler(request(undefined, undefined, headers));
    assert.ok([401, 403, 503].includes(response.status));
    assert.equal(f.state.calls.some(call => call.name === 'createCustomer' || call.name === 'createCheckout'), false);
  }
});
test('existing lifetime buyer cannot be sold the covered membership', async () => {
  const f = fixture(); f.state.grant = { active: true, plan: 'lifetime', accessScope: 'all-current-and-future-trainers' };
  assert.deepEqual(await result(await f.handler(request())), { status: 409, body: { error: 'lifetime_access_already_covers_membership' } });
  assert.equal(f.state.calls.find(call => call.name === 'legacy').args[0], 'tester@example.invalid');
  assert.equal(f.state.calls.some(call => call.name === 'createCustomer'), false);
});
test('lookup failure preserves lifetime protection rather than treating it as no grant', async () => {
  const f = fixture(); f.ports.legacyEntitlement = async () => { throw new Error('private source details'); };
  assert.deepEqual(await result(await f.handler(request())), { status: 503, body: { error: 'billing_temporarily_unavailable' } });
  assert.equal(f.state.calls.some(call => call.name === 'createCustomer'), false);
});
test('client cannot supply price, UID, customer, quantity or redirect values', async () => {
  for (const extra of [{ price: 'price_other' }, { uid: 'another' }, { customer: 'cus_other' }, { quantity: 0 }, { return_url: 'https://attacker.invalid' }]) {
    const f = fixture(); assert.equal((await f.handler(request(undefined, { plan: 'monthly', requestId, ...extra }))).status, 400);
    assert.equal(f.state.calls.some(call => call.name === 'createCheckout'), false);
  }
});
test('server checkout uses allowlisted recurring price, quantity one and immutable UID metadata', async () => {
  const f = fixture(); const response = await result(await f.handler(request())); assert.equal(response.status, 200);
  const params = f.state.calls.find(call => call.name === 'createCheckout').args[0];
  assert.deepEqual(params, checkoutParameters(f.config, { uid: account.uid }, binding.customerId, 'monthly'));
  assert.equal(params.mode, 'subscription'); assert.deepEqual(params.line_items, [{ price: 'price_monthly', quantity: 1 }]);
  assert.equal(params.subscription_data.metadata.firebaseUid, account.uid);
  assert.equal(params.success_url, 'https://minimalpairs.co/account?billing=return');
  assert.equal('trial_period_days' in params.subscription_data, false);
  const reserveIndex = f.state.calls.findIndex(call => call.name === 'savePending');
  assert.ok(reserveIndex < f.state.calls.findIndex(call => call.name === 'createCheckout'));
});
test('monthly/annual price interval validation fails closed', async () => {
  for (const change of [{ interval: 'week' }, { intervalCount: 2 }, { currency: 'eur' }, { id: 'not_a_price' }]) {
    const f = fixture(); Object.assign(f.config.prices.monthly, change);
    assert.equal((await f.handler(request())).status, 503);
    assert.equal(f.state.calls.some(call => call.name === 'createCustomer'), false);
  }
});
test('mapped customer must match current UID, exact ID and Stripe mode', async () => {
  for (const change of [{ id: 'cus_another' }, { metadata: { firebaseUid: 'someone_else' } }, { livemode: true }, { deleted: true }]) {
    const f = fixture(); f.state.customerId = binding.customerId;
    f.ports.stripe.retrieveCustomer = async () => ({ ...customer(), ...change });
    assert.equal((await f.handler(request())).status, 409);
    assert.equal(f.state.calls.some(call => call.name === 'createCheckout'), false);
  }
});
test('existing active, delinquent, paused and incomplete subscriptions require portal, never another checkout', async () => {
  for (const status of ['active', 'past_due', 'unpaid', 'paused', 'trialing', 'incomplete', 'unknown']) {
    const f = fixture(); f.state.customerId = binding.customerId; f.state.subscriptions = [{ status }];
    assert.deepEqual(await result(await f.handler(request())), { status: 409, body: { error: 'existing_subscription_use_portal' } });
  }
  const f = fixture(); f.state.subscriptions = [{ status: 'canceled' }, { status: 'incomplete_expired' }];
  assert.equal((await f.handler(request())).status, 200);
});
test('open checkout is reused; a second plan is blocked until it expires', async () => {
  const f = fixture(); await f.handler(request());
  assert.equal((await f.handler(request(undefined, { plan: 'monthly', requestId: secondRequestId }))).status, 200);
  assert.equal(f.state.calls.filter(call => call.name === 'createCheckout').length, 1);
  assert.equal((await f.handler(request(undefined, { plan: 'annual', requestId: secondRequestId }))).status, 409);
  f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'expired', url: null });
  assert.equal((await f.handler(request(undefined, { plan: 'annual', requestId: secondRequestId }))).status, 200);
  assert.equal(f.state.pending.plan, 'annual');
});
test('pending session with wrong binding or completed state cannot create another session', async () => {
  for (const change of [{ customer: 'cus_other' }, { client_reference_id: 'another' }, { livemode: true }, { status: 'complete' }]) {
    const f = fixture(); await f.handler(request()); f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), ...change });
    assert.ok([409, 502].includes((await f.handler(request())).status));
    assert.equal(f.state.calls.filter(call => call.name === 'createCheckout').length, 1);
  }
});
test('crash after checkout creation keeps reserved operation key across a new client request', async () => {
  const f = fixture(); const save = f.ports.billing.savePendingCheckout; let crash = true;
  f.ports.billing.savePendingCheckout = async (uid, pending) => {
    if (pending.sessionId && crash) { crash = false; throw new Error('simulated durable write failure'); }
    return save(uid, pending);
  };
  assert.equal((await f.handler(request())).status, 503);
  assert.equal(f.state.pending.sessionId, undefined);
  assert.equal((await f.handler(request(undefined, { plan: 'monthly', requestId: secondRequestId }))).status, 200);
  const attempts = f.state.calls.filter(call => call.name === 'createCheckout');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].args[1], attempts[1].args[1]);
  assert.equal(attempts[0].args[1].includes(account.uid), false);
  assert.equal(f.state.pending.requestId, requestId);
});
test('unknown checkout older than safe Stripe idempotency window waits for reconciliation', async () => {
  const f = fixture(); f.state.customerId = binding.customerId;
  f.state.pending = { plan: 'monthly', requestId, operationId: secondRequestId, createdAt: Math.floor(Date.now() / 1000) - 24 * 3600,
    parameters: checkoutParameters(f.config, account, binding.customerId, 'monthly') };
  assert.deepEqual(await result(await f.handler(request())), { status: 409, body: { error: 'checkout_reconciliation_pending' } });
  assert.equal(f.state.calls.some(call => call.name === 'createCheckout'), false);
});
test('reserved and open checkouts cannot silently adopt changed price or return-page configuration', async () => {
  for (const ambiguous of [false, true]) {
    const f = fixture(); await f.handler(request());
    if (ambiguous) delete f.state.pending.sessionId;
    f.config.prices.monthly.id = 'price_replacement';
    assert.deepEqual(await result(await f.handler(request())), { status: 409, body: { error: 'checkout_configuration_changed' } });
    assert.equal(f.state.calls.filter(call => call.name === 'createCheckout').length, 1);
  }
});
test('durable JSON key normalization does not block a valid reserved or open checkout', async () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
  for (const ambiguous of [false, true]) {
    const f = fixture(); await f.handler(request());
    f.state.pending.parameters = reorder(f.state.pending.parameters);
    if (ambiguous) delete f.state.pending.sessionId;
    assert.equal((await f.handler(request())).status, 200);
  }
});
test('canonical parameter equality preserves arrays, value types and changed nested values', () => {
  assert.equal(sameCheckoutParameters({ b: { y: 2, x: 1 }, a: [1, 2] }, { a: [1, 2], b: { x: 1, y: 2 } }), true);
  assert.equal(sameCheckoutParameters({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameCheckoutParameters({ a: 1 }, { a: '1' }), false);
  assert.equal(sameCheckoutParameters({ a: { quantity: 1 } }, { a: { quantity: 2 } }), false);
  assert.equal(sameCheckoutParameters(undefined, undefined), false);
});
test('customer creation reservation retains key and original email through retry; old unknown result is blocked', async () => {
  const f = fixture(); const bind = f.ports.billing.bindCustomer; let crash = true;
  f.ports.billing.bindCustomer = async (...args) => { if (crash) { crash = false; throw new Error('crash'); } return bind(...args); };
  assert.equal((await f.handler(request())).status, 503);
  f.ports.auth.verifyIdToken = async () => ({ ...account, email: 'new@example.invalid' });
  assert.equal((await f.handler(request())).status, 200);
  const calls = f.state.calls.filter(call => call.name === 'createCustomer');
  assert.deepEqual(calls[0].args, calls[1].args); assert.equal(calls[0].args[0].email, 'tester@example.invalid');
  const stale = fixture(); stale.state.customerReservation = { requestId, email: 'synthetic@example.invalid', createdAt: Math.floor(Date.now() / 1000) - 24 * 3600 };
  assert.equal((await stale.handler(request())).status, 409);
  assert.equal(stale.state.calls.some(call => call.name === 'createCustomer'), false);
});
test('portal stays available when sales are disabled and only opens the server-bound customer', async () => {
  const f = fixture(); f.config.checkoutEnabled = false; f.state.customerId = binding.customerId;
  assert.equal((await f.handler(request())).status, 503);
  assert.equal((await f.handler(request('/billing/portal', {}))).status, 200);
  assert.deepEqual(f.state.calls.find(call => call.name === 'createPortal').args[0], { customer: binding.customerId, configuration: 'bpc_synthetic', return_url: 'https://minimalpairs.co/account' });
  assert.equal((await f.handler(request('/billing/portal', { customer: 'cus_other' }))).status, 400);
});
test('provider URLs cannot redirect to a lookalike, custom port or credential-bearing origin', async () => {
  for (const url of ['https://checkout.stripe.com.attacker.invalid/pay', 'https://checkout.stripe.com:444/pay', 'https://user@checkout.stripe.com/pay', 'http://checkout.stripe.com/pay']) {
    const f = fixture(); f.ports.stripe.createCheckoutSession = async () => ({ ...checkout(), url });
    assert.equal((await f.handler(request())).status, 502);
  }
});
test('request bodies have a streaming limit even without Content-Length', async () => {
  const f = fixture();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2100)); controller.close(); } });
  const response = await f.handler(new Request('https://billing.example.invalid/billing/checkout', { method: 'POST',
    headers: { Origin: f.config.appOrigin, Authorization: 'Bearer synthetic.server.verified.token' }, body: stream, duplex: 'half' }));
  assert.equal(response.status, 413); assert.equal(f.state.calls.some(call => call.name === 'createCustomer'), false);
});

test('webhook verifies exact raw bytes and queues only minimal identifiers', async () => {
  const data = signed();
  const envelope = await verifyStripeEvent(data.raw, data.header, [secret], { now: NOW * 1000, expectedLivemode: false });
  assert.deepEqual(envelope, { schemaVersion: 1, eventId: 'evt_synthetic', type: 'invoice.paid', objectId: 'in_synthetic', livemode: false, created: NOW, receivedAt: NOW });
  assert.equal(JSON.stringify(envelope).includes('example.invalid'), false);
  await rejectCode(verifyStripeEvent(Buffer.concat([data.raw, Buffer.from(' ')]), data.header, [secret], { now: NOW * 1000, expectedLivemode: false }), 'invalid_signature');
});
test('checkout cs_test object IDs are valid webhook subjects', async () => {
  const data = signed(event({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_synthetic' } } }));
  assert.equal((await verifyStripeEvent(data.raw, data.header, [secret], { now: NOW * 1000, expectedLivemode: false })).objectId, 'cs_test_synthetic');
});
test('webhook supports secret rotation/multiple v1 signatures while rejecting v0 and duplicate timestamps', async () => {
  const data = signed(); const header = `${data.header},v1=${'0'.repeat(64)}`;
  assert.equal((await verifyStripeEvent(data.raw, header, ['whsec_previousSynthetic', secret], { now: NOW * 1000, expectedLivemode: false })).eventId, 'evt_synthetic');
  await rejectCode(verifyStripeEvent(data.raw, data.header.replace('v1=', 'v0='), [secret], { now: NOW * 1000, expectedLivemode: false }), 'invalid_signature');
  await rejectCode(verifyStripeEvent(data.raw, `${data.header},t=${NOW}`, [secret], { now: NOW * 1000, expectedLivemode: false }), 'invalid_signature');
});
test('old/future, malformed, wrong-mode and connected-account webhooks are rejected', async () => {
  for (const timestamp of [NOW - 301, NOW + 301]) {
    const data = signed(event(), timestamp);
    await rejectCode(verifyStripeEvent(data.raw, data.header, [secret], { now: NOW * 1000, expectedLivemode: false }), 'stale_signature');
  }
  for (const value of [event({ livemode: true }), event({ account: 'acct_other' }), event({ id: 'notAnEvent' })]) {
    const data = signed(value);
    await rejectCode(verifyStripeEvent(data.raw, data.header, [secret], { now: NOW * 1000, expectedLivemode: false }), 'wrong_event_scope');
  }
  const malformed = signed('{');
  await rejectCode(verifyStripeEvent(malformed.raw, malformed.header, [secret], { now: NOW * 1000, expectedLivemode: false }), 'invalid_event');
});
test('webhook size and unconfigured secret fail closed', async () => {
  const data = signed();
  await rejectCode(verifyStripeEvent(data.raw, data.header, [], { now: NOW * 1000, expectedLivemode: false }), 'webhook_not_configured');
  await rejectCode(verifyStripeEvent(new Uint8Array(1_048_577), data.header, [secret], { now: NOW * 1000, expectedLivemode: false }), 'webhook_too_large');
});
test('HTTP webhook acknowledges only after durable enqueue and safely accepts duplicates', async () => {
  const f = fixture(); const data = signed(event(), Math.floor(Date.now() / 1000));
  const req = () => new Request('https://billing.example.invalid/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': data.header }, body: data.raw });
  assert.equal((await f.handler(req())).status, 200); assert.equal((await f.handler(req())).status, 200); assert.equal(f.state.queued.size, 1);
  f.ports.billing.enqueue = async () => { throw new Error('storage unavailable'); };
  assert.equal((await f.handler(req())).status, 503);
  assert.equal(f.state.projected.length, 0); // Checkout or invoice delivery never directly grants.
});

test('paid term, scheduled cancellation and past_due with prior still-paid coverage retain access', () => {
  for (const changes of [{}, { cancelAtPeriodEnd: true }, { status: 'past_due' }]) {
    const grant = subscriptionEntitlement({ ...snapshot(), ...changes }, binding, config(), NOW);
    assert.equal(grant.active, true); assert.equal(grant.currentPeriodEnd, NOW + 10_000);
  }
  const shortened = subscriptionEntitlement({ ...snapshot(), cancelAt: NOW + 100 }, binding, config(), NOW);
  assert.equal(shortened.currentPeriodEnd, NOW + 100);
});
test('status alone never grants; no trials, unpaid grace or canceled access', () => {
  for (const status of ['trialing', 'incomplete', 'incomplete_expired', 'paused', 'unpaid', 'canceled', 'unknown']) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), status }, binding, config(), NOW).active, false);
  }
  for (const period of [[], [{ ...paidPeriod(), invoiceStatus: 'uncollectible' }], [{ ...paidPeriod(), amountPaid: 0 }], [{ ...paidPeriod(), successfulCharge: false }], [{ ...paidPeriod(), end: NOW }]]) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), paidPeriods: period }, binding, config(), NOW).active, false);
  }
});
test('full current refund/open or lost dispute removes coverage; partial refund and won dispute retain it', () => {
  for (const changes of [{ amountRefunded: 900 }, { amountRefunded: 901 }, { disputeStatus: 'open' }, { disputeStatus: 'lost' }]) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), paidPeriods: [{ ...paidPeriod(), ...changes }] }, binding, config(), NOW).active, false);
  }
  for (const changes of [{ amountRefunded: 1 }, { disputeStatus: 'won' }]) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), paidPeriods: [{ ...paidPeriod(), ...changes }] }, binding, config(), NOW).active, true);
  }
});
test('refund of an old period does not revoke separately paid current coverage', () => {
  const oldRefund = { ...paidPeriod(), invoiceId: 'in_old', start: NOW - 30_000, end: NOW - 10_000, amountRefunded: 900 };
  const grant = subscriptionEntitlement({ ...snapshot(), paidPeriods: [oldRefund, paidPeriod()] }, binding, config(), NOW);
  assert.equal(grant.active, true);
});
test('binding, mode, price, multi-item, quantity and admin block cannot be bypassed by a paid invoice', () => {
  for (const changes of [{ uid: 'another' }, { customerId: 'cus_another' }, { livemode: true }, { priceId: 'price_other' }, { itemCount: 2 }, { quantity: 2 }, { adminBlocked: true }, { currency: 'eur' }, { currentPeriodStart: NOW + 10 }, { cancelAt: NOW }]) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), ...changes }, binding, config(), NOW).active, false);
  }
  for (const changes of [{ subscriptionId: 'sub_other' }, { priceId: 'price_other' }, { currency: 'eur' }]) {
    assert.equal(subscriptionEntitlement({ ...snapshot(), paidPeriods: [{ ...paidPeriod(), ...changes }] }, binding, config(), NOW).active, false);
  }
});

async function queuedFixture() {
  const f = fixture(); const data = signed();
  await f.ports.billing.enqueue(await verifyStripeEvent(data.raw, data.header, [secret], { now: NOW * 1000, expectedLivemode: false }));
  return f;
}
test('disabled billing also stops background processing before any adapter access', async () => {
  await rejectCode(processQueuedEvent('evt_synthetic', { ...config(), serviceEnabled: false }, {}, NOW), 'billing_not_enabled');
});
test('processor projects current server state, then marks processed; duplicate ID has no further effect', async () => {
  const f = await queuedFixture();
  assert.equal((await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW)).active, true);
  assert.equal(f.state.projected.length, 1);
  assert.deepEqual(await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW + 1), { duplicate: true });
  assert.equal(f.state.projected.length, 1);
  assert.ok(f.state.calls.findIndex(call => call.name === 'project') < f.state.calls.findIndex(call => call.name === 'markProcessed'));
});
test('projection failure leaves event pending for retry and does not mark it processed', async () => {
  const f = await queuedFixture(); const project = f.ports.entitlements.projectSubscription;
  f.ports.entitlements.projectSubscription = async () => { throw new Error('Firestore unavailable'); };
  await assert.rejects(processQueuedEvent('evt_synthetic', f.config, f.ports, NOW));
  assert.equal(f.state.queued.get('evt_synthetic').processed, false);
  f.ports.entitlements.projectSubscription = project;
  assert.equal((await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW)).active, true);
});
test('crash after projection refetches current state on retry, without touching lifetime grants', async () => {
  const f = await queuedFixture(); const mark = f.ports.billing.markProcessed;
  f.ports.billing.markProcessed = async () => { throw new Error('crash after projection'); };
  await assert.rejects(processQueuedEvent('evt_synthetic', f.config, f.ports, NOW));
  f.ports.billing.markProcessed = mark;
  f.ports.stripe.currentSubscriptionSnapshot = async () => ({ ...snapshot(), status: 'canceled' });
  assert.equal((await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW + 1)).active, false);
  assert.equal(f.state.projected.length, 2);
  assert.equal(f.state.calls.some(call => call.name === 'legacy'), false);
  assert.deepEqual(Object.keys(f.ports.entitlements), ['projectSubscription']);
});
test('old canceled-subscription event cannot use its stale payload to overwrite a newer paid subscription', async () => {
  const f = await queuedFixture();
  Object.assign(f.state.queued.get('evt_synthetic').event, { type: 'customer.subscription.deleted', objectId: 'sub_old', created: NOW - 50_000 });
  // The adapter must select the current customer state, not the event's sub_old.
  assert.equal((await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW)).active, true);
  assert.equal(f.state.projected[0].data.subscriptionId, 'sub_synthetic');
  assert.deepEqual(f.state.calls.find(call => call.name === 'snapshot').args, [binding]);
});
test('unresolved binding/network snapshot does not acknowledge completion or write any grant', async () => {
  for (const broken of ['binding', 'snapshot']) {
    const f = await queuedFixture();
    if (broken === 'binding') f.ports.billing.resolveEventBinding = async () => null;
    else f.ports.stripe.currentSubscriptionSnapshot = async () => null;
    await assert.rejects(processQueuedEvent('evt_synthetic', f.config, f.ports, NOW));
    assert.equal(f.state.projected.length, 0); assert.equal(f.state.queued.get('evt_synthetic').processed, false);
  }
});
test('canonical reconciliation retires the exact completed checkout so canceled subscribers can return', async () => {
  const f = await queuedFixture(); await f.handler(request());
  f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'complete', subscription: 'sub_synthetic' });
  f.ports.stripe.currentSubscriptionSnapshot = async () => ({ ...snapshot(), status: 'canceled' });
  f.state.subscriptions = [{ id: 'sub_synthetic', status: 'canceled' }];
  assert.equal((await f.handler(request())).status, 409); // Still ambiguous before reconciliation.
  assert.equal((await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW)).active, false);
  assert.equal(f.state.pending, null);
  assert.equal((await f.handler(request(undefined, { plan: 'monthly', requestId: secondRequestId }))).status, 200);
});
test('a completed checkout for a different, not-yet-reconciled subscription stays reserved', async () => {
  const f = await queuedFixture(); await f.handler(request());
  f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'complete', subscription: 'sub_notYetReconciled' });
  await processQueuedEvent('evt_synthetic', f.config, f.ports, NOW);
  assert.equal(f.state.pending.sessionId, 'cs_test_synthetic');
  assert.equal(f.state.calls.some(call => call.name === 'retirePending'), false);
});

test('periodic reconciliation requires enabled service and a durable binding before fetching canonical state', async () => {
  await rejectCode(reconcileBoundCustomer(account.uid, { ...config(), serviceEnabled: false }, {}, NOW), 'billing_not_enabled');
  const f = fixture();
  await rejectCode(reconcileBoundCustomer(account.uid, f.config, f.ports, NOW), 'customer_binding_unresolved');
  assert.equal(f.state.calls.some(call => call.name === 'snapshot'), false);
  assert.equal(f.state.projected.length, 0);
  f.state.customerId = binding.customerId;
  assert.equal((await reconcileBoundCustomer(account.uid, f.config, f.ports, NOW)).active, true);
  assert.deepEqual(f.state.calls.find(call => call.name === 'snapshot').args, [binding]);
  assert.equal(f.state.queued.size, 0);
  assert.equal(f.state.calls.some(call => call.name === 'resolveBinding' || call.name === 'legacy' || call.name === 'markProcessed'), false);
});
test('periodic recovery uses the same refund/admin rules and exact completed-checkout retirement as webhooks', async () => {
  for (const changes of [{}, { adminBlocked: true }, { paidPeriods: [{ ...paidPeriod(), amountRefunded: 900 }] }]) {
    const f = fixture(); await f.handler(request());
    f.ports.stripe.currentSubscriptionSnapshot = async () => ({ ...snapshot(), ...changes });
    f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'complete', subscription: 'sub_synthetic' });
    const result = await reconcileBoundCustomer(account.uid, f.config, f.ports, NOW);
    assert.equal(result.active, Object.keys(changes).length === 0);
    assert.equal(f.state.pending, null);
    assert.deepEqual(Object.keys(f.ports.entitlements), ['projectSubscription']);
  }
  const f = fixture(); await f.handler(request());
  f.ports.stripe.retrieveCheckoutSession = async () => ({ ...checkout(), status: 'complete', subscription: 'sub_other' });
  await reconcileBoundCustomer(account.uid, f.config, f.ports, NOW);
  assert.equal(f.state.pending.sessionId, 'cs_test_synthetic');
});
test('periodic recovery cannot project a mismatched mode/customer/UID snapshot or incomplete retrieval', async () => {
  for (const changes of [null, { livemode: true }, { customerId: 'cus_other' }, { uid: 'other' }]) {
    const f = fixture(); f.state.customerId = binding.customerId;
    f.ports.stripe.currentSubscriptionSnapshot = async () => changes === null ? null : { ...snapshot(), ...changes };
    await rejectCode(reconcileBoundCustomer(account.uid, f.config, f.ports, NOW), 'snapshot_binding_invalid');
    assert.equal(f.state.projected.length, 0);
  }
});

test('annual can remain approved for old subscriptions while no longer sold',()=>{
 const c=config();c.prices.annual.sellable=false;
 assert.throws(()=>checkoutParameters(c,account,binding.customerId,'annual'),/plan_not_available/);
 const old=snapshot();old.priceId='price_annual';old.interval='year';old.paidPeriods[0].priceId='price_annual';
 assert.equal(subscriptionEntitlement(old,binding,c,NOW).active,true);
});
test('lifetime projection rejects missing proof and retains no expiry only for verified exact payment',()=>{
 const c=config();c.prices.lifetime={id:'price_lifetime',currency:'usd',unitAmount:2900,interval:null,intervalCount:0};
 const value={...binding,livemode:false,plan:'lifetime',priceId:'price_lifetime',currency:'usd',amountPaid:2900,amountRefunded:0,successfulCharge:true,disputeStatus:'none',checkoutSessionId:'cs_test_lifetime',paymentIntentId:'pi_lifetime'};
 assert.equal(subscriptionEntitlement(value,binding,c,NOW).active,true);
 for(const change of [{amountPaid:0},{amountPaid:3900},{successfulCharge:false},{amountRefunded:2900},{disputeStatus:'open'},{uid:'wrong'},{livemode:true},{paymentIntentId:null}])assert.equal(subscriptionEntitlement({...value,...change},binding,c,NOW).active,false);
});

test('coarse attribution is snapshotted before Stripe and retries preserve it', async () => {
 for(const ambiguous of [false,true]){
  const f=fixture();
  const analytics={source:'google',medium:'organic',campaign:'diagnostic',ui_locale:'fr',landing_page:'/fr/diagnostic/en',experiment_id:'diag-paywall-v1',experiment_variant:'paid',offer_placement:'diagnostic-report'};
  assert.equal((await f.handler(request(undefined,{plan:'monthly',requestId,analytics}))).status,200);
  const original=structuredClone(f.state.pending.parameters);
  assert.equal(original.metadata.mp_source,'google');
  assert.equal(original.metadata.mp_experiment_id,'diag-paywall-v1');
  assert.equal(original.metadata.mp_experiment_variant,'paid');
  assert.equal(original.metadata.mp_offer_placement,'diagnostic-report');
  assert.equal(original.metadata.mp_ui_locale,'fr');
  assert.equal(original.metadata.mp_landing_page,'/fr/diagnostic/en');
  assert.equal(original.subscription_data.metadata.mp_source,undefined);
  if(ambiguous)delete f.state.pending.sessionId;
  assert.equal((await f.handler(request(undefined,{plan:'monthly',requestId:secondRequestId,analytics:{source:'reddit',medium:'social',ui_locale:'en'}}))).status,200);
  assert.deepEqual(f.state.pending.parameters,original);
 }
});
test('older monthly reservations without plan metadata remain resumable',async()=>{
 const f=fixture();assert.equal((await f.handler(request())).status,200);
 delete f.state.pending.parameters.metadata.plan;
 assert.equal((await f.handler(request())).status,200);
 assert.equal(f.state.pending.parameters.metadata.plan,undefined);
});
test('freeform attribution is dropped and normal checkout remains possible',async()=>{
 for(const analytics of [{source:'someone@example.com',medium:'organic',ui_locale:'en'},{source:'google',medium:'organic',ui_locale:'en',email:'private@example.invalid'},{source:'google',medium:'organic',ui_locale:'en',campaign:'https://secret.invalid/'},'private',null]){
  const f=fixture();assert.equal((await f.handler(request(undefined,{plan:'monthly',requestId,analytics}))).status,200);
  assert.equal(Object.keys(f.state.pending.parameters.metadata).some(k=>k.startsWith('mp_')),false);
 }
 const f=fixture();await f.handler(request());delete f.state.pending.sessionId;
 await f.handler(request(undefined,{plan:'monthly',requestId,analytics:{source:'google',medium:'organic',ui_locale:'en'}}));
 assert.equal(f.state.pending.parameters.metadata.mp_source,undefined);
});
test('an expired checkout gets fresh attribution while retaining normal plan validation',async()=>{
 const f=fixture();await f.handler(request(undefined,{plan:'monthly',requestId,analytics:{source:'google',medium:'organic',ui_locale:'en'}}));
 f.ports.stripe.retrieveCheckoutSession=async()=>({...checkout(),status:'expired'});
 assert.equal((await f.handler(request(undefined,{plan:'monthly',requestId:secondRequestId,analytics:{source:'reddit',medium:'social',ui_locale:'fr'}}))).status,200);
 assert.equal(f.state.pending.parameters.metadata.mp_source,'reddit');
 assert.equal(f.state.pending.parameters.metadata.mp_ui_locale,'fr');
});

test('recovery parameters bind approved coupon and finite expiry, never arbitrary browser pricing',()=>{
 const cfg={...config(),recoveryCouponId:'recovery50',prices:{...config().prices,lifetime:{id:'price_lifetime',unitAmount:2900,currency:'usd',interval:null,intervalCount:0}}};
 const base=checkoutParameters(cfg,account,binding.customerId,'lifetime');
 const out=recoveryParameters(base,cfg,{expiresAt:NOW+4000},NOW);
 assert.deepEqual(out.discounts,[{coupon:'recovery50'}]);assert.equal(out.expires_at,NOW+4000);assert.equal(out.allow_promotion_codes,undefined);
 assert.throws(()=>recoveryParameters(base,cfg,{expiresAt:NOW+100},NOW));
 assert.throws(()=>recoveryParameters(base,{...cfg,recoveryCouponId:null},{expiresAt:NOW+4000},NOW));
});
test('recovery expires original before creating replacement and reuses discounted checkout',async()=>{
 const f=fixture();f.config.recoveryCouponId='recovery50';f.config.prices.lifetime={id:'price_lifetime',unitAmount:2900,currency:'usd',interval:null,intervalCount:0};
 f.state.customerId=binding.customerId;
 const now=Math.floor(Date.now()/1000);let offer=null;let expired=false;
 f.ports.billing.recoveryOffer=async()=>offer;
 f.ports.billing.reserveRecoveryOffer=async(uid,v)=>offer??=v;
 f.ports.stripe.currentSubscriptionSnapshot=async()=>({...binding,livemode:false,status:'none'});
 f.ports.stripe.createCheckoutSession=async(params)=>({...checkout(),mode:'payment',id:params.discounts?'cs_test_discount':'cs_test_synthetic'});
 f.ports.stripe.retrieveCheckoutSession=async(id)=>({...checkout(),id,mode:'payment',status:expired && id==='cs_test_synthetic'?'expired':'open'});
 f.ports.stripe.expireCheckoutSession=async(id)=>{expired=true;return {...checkout(),id,mode:'payment',status:'expired'};};
 let res=await f.handler(request('/billing/checkout',{plan:'lifetime',requestId}));assert.equal(res.status,200);assert.equal(offer.expiresAt,now+172800);
 res=await f.handler(request('/billing/recovery-offer',{}));assert.equal((await res.json()).eligible,true);
 res=await f.handler(request('/billing/checkout',{plan:'lifetime',requestId:secondRequestId,recovery:true}));assert.equal(res.status,200);assert.equal(expired,true);assert.equal(f.state.pending.parameters.discounts[0].coupon,'recovery50');
 const operation=f.state.pending.operationId;
 res=await f.handler(request('/billing/checkout',{plan:'lifetime',requestId:secondRequestId,recovery:true}));assert.equal(res.status,200);assert.equal(f.state.pending.operationId,operation);
 offer.expiresAt=now-1;
 res=await f.handler(request('/billing/checkout',{plan:'lifetime',requestId:secondRequestId,recovery:true}));assert.equal(res.status,409);
});

test('inconclusive membership snapshot cannot erase an existing paid grant and stays retryable', async () => {
 const f=await queuedFixture();
 f.ports.stripe.currentSubscriptionSnapshot=async()=>({...binding,livemode:false,subscriptionId:null,status:'none',paidPeriods:[]});
 await rejectCode(processQueuedEvent('evt_synthetic',f.config,f.ports,NOW),'snapshot_unverified');
 assert.equal(f.state.projected.length,0);
 assert.equal(f.state.queued.get('evt_synthetic').processed,false);
 f.ports.stripe.currentSubscriptionSnapshot=async()=>snapshot();
 assert.equal((await processQueuedEvent('evt_synthetic',f.config,f.ports,NOW+1)).active,true);
});
