import test from 'node:test';
import assert from 'node:assert/strict';
import { createStripeAdapter, STRIPE_API_VERSION, StripeAdapterError } from './stripe.mjs';
import { checkoutParameters, subscriptionEntitlement } from '../core.mjs';

const NOW = 1_800_000_000;
const binding = { uid: 'syntheticLearner', customerId: 'cus_synthetic' };
const key = 'rk_test_syntheticFixtureOnly';
const prices = { monthly: { id: 'price_monthly', currency: 'usd', interval: 'month', intervalCount: 1, unitAmount: 900 } };
const config = { serviceEnabled: true, checkoutEnabled: true, communicationsApproved: true, expectedLivemode: false, appOrigin: 'https://example.invalid', prices };
const clone = value => JSON.parse(JSON.stringify(value));
const pageOf = (data, more = false) => ({ object: 'list', data, has_more: more, url: '/v1/fixture' });

function fixture(options = {}) {
  const data = {
    customer: { object: 'customer', id: binding.customerId, livemode: false, metadata: { firebaseUid: binding.uid, billingSchema: '1' } },
    price: { object: 'price', id: 'price_monthly', livemode: false, active: true, type: 'recurring', currency: 'usd', unit_amount: 900,
      unit_amount_decimal: '900', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit',
      transform_quantity: null, tiers_mode: null, custom_unit_amount: null },
    item: { object: 'subscription_item', id: 'si_synthetic', subscription: 'sub_synthetic', quantity: 1, price: 'price_monthly',
      current_period_start: NOW - 1000, current_period_end: NOW + 1000, discounts: [], tax_rates: [] },
    subscription: { object: 'subscription', id: 'sub_synthetic', customer: binding.customerId, livemode: false, created: NOW - 2000,
      status: 'active', metadata: { firebaseUid: binding.uid, billingSchema: '1' }, collection_method: 'charge_automatically',
      currency: 'usd', billing_mode: { type: 'flexible' }, automatic_tax: { enabled: false }, discounts: [], billing_schedules: [],
      cancel_at: null, cancel_at_period_end: false },
    line: { object: 'line_item', id: 'il_synthetic', livemode: false, invoice: 'in_synthetic', amount: 900, currency: 'usd', quantity: 1,
      quantity_decimal: '1', period: { start: NOW - 1000, end: NOW + 1000 }, parent: { type: 'subscription_item_details',
        subscription_item_details: { subscription: 'sub_synthetic', subscription_item: 'si_synthetic', proration: false, invoice_item: null } },
      pricing: { type: 'price_details', price_details: { price: 'price_monthly', product: 'prod_synthetic' } },
      discounts: [], discount_amounts: [], pretax_credit_amounts: [], taxes: [] },
    invoice: { object: 'invoice', id: 'in_synthetic', livemode: false, customer: binding.customerId, status: 'paid',
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_synthetic' } },
      billing_reason: 'subscription_cycle', collection_method: 'charge_automatically', currency: 'usd',
      amount_paid: 900, amount_due: 900, total: 900, subtotal: 900, amount_remaining: 0, amount_overpaid: 0,
      starting_balance: 0, ending_balance: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
      automatic_tax: { enabled: false }, discounts: [], total_discount_amounts: [], total_taxes: [], total_pretax_credit_amounts: [],
      amount_shipping: 0, period_start: NOW - 90000, period_end: NOW - 80000 },
    payment: { object: 'invoice_payment', id: 'inpay_synthetic', invoice: 'in_synthetic', livemode: false, is_default: true,
      status: 'paid', currency: 'usd', amount_paid: 900, amount_requested: 900, payment: { type: 'payment_intent', payment_intent: 'pi_synthetic' } },
    intent: { object: 'payment_intent', id: 'pi_synthetic', livemode: false, customer: binding.customerId, status: 'succeeded',
      currency: 'usd', amount: 900, amount_received: 900, amount_capturable: 0, capture_method: 'automatic_async',
      payment_method_types: ['card'], latest_charge: 'ch_synthetic' },
    charge: { object: 'charge', id: 'ch_synthetic', livemode: false, customer: binding.customerId, payment_intent: 'pi_synthetic',
      status: 'succeeded', paid: true, captured: true, amount: 900, amount_captured: 900, amount_refunded: 0,
      currency: 'usd', payment_method_details: { type: 'card' }, disputed: false },
    checkout: { object: 'checkout.session', id: 'cs_test_synthetic', livemode: false, customer: binding.customerId,
      client_reference_id: binding.uid, mode: 'subscription', status: 'open', subscription: null, url: 'https://checkout.stripe.com/c/pay/synthetic' },
    portal: { object: 'billing_portal.session', id: 'bps_synthetic', customer: binding.customerId, livemode: false, url: 'https://billing.stripe.com/p/session/synthetic' },
    refunds: [], disputes: [],
  };
  data.subscription.items = pageOf([data.item]); data.invoice.lines = pageOf([data.line]);
  data.subscriptions = [data.subscription]; data.invoices = [data.invoice];
  const requests = [], routes = new Map([
    ['GET /v1/account', () => ({ object: 'account', id: 'acct_synthetic' })],
    [`GET /v1/customers/${binding.customerId}`, () => data.customer],
    ['POST /v1/customers', () => data.customer],
    ['GET /v1/subscriptions', () => pageOf(data.subscriptions)],
    ['GET /v1/subscriptions/sub_synthetic', () => data.subscription],
    ['GET /v1/subscription_items', () => pageOf([data.item])],
    ['GET /v1/prices/price_monthly', () => data.price],
    ['GET /v1/invoices', () => pageOf(data.invoices)],
    ['GET /v1/invoices/in_synthetic', () => data.invoice],
    ['GET /v1/invoices/in_synthetic/lines', () => pageOf([data.line])],
    ['GET /v1/invoice_payments', () => pageOf([data.payment])],
    ['GET /v1/payment_intents/pi_synthetic', () => data.intent],
    ['GET /v1/charges', () => pageOf([data.charge])],
    ['GET /v1/charges/ch_synthetic', () => data.charge],
    ['GET /v1/refunds', () => pageOf(data.refunds)],
    ['GET /v1/disputes', () => pageOf(data.disputes)],
    ['POST /v1/checkout/sessions', () => data.checkout],
    ['GET /v1/checkout/sessions/cs_test_synthetic', () => data.checkout],
    ['POST /v1/billing_portal/sessions', () => data.portal],
    ['GET /v1/billing_portal/configurations/bpc_synthetic', () => ({ object: 'billing_portal.configuration', id: 'bpc_synthetic', livemode: false, active: true,
      features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, payment_method_update: { enabled: true } } })],
  ]);
  const fetchImpl = async (input, init) => {
    const url = new URL(input), headers = new Headers(init.headers);
    const r = { url, method: init.method, headers, body: new URLSearchParams(init.body), init };
    requests.push(r);
    assert.equal(url.origin, 'https://api.stripe.com');
    assert.equal(headers.get('authorization'), `Bearer ${key}`);
    assert.equal(headers.get('stripe-version'), STRIPE_API_VERSION);
    assert.equal(headers.has('stripe-account'), false);
    assert.equal(init.redirect, 'manual');
    const route = routes.get(`${r.method} ${url.pathname}`);
    assert.ok(route, `Missing synthetic route: ${r.method} ${url.pathname}`);
    const result = typeof route === 'function' ? await route(r) : route;
    return result instanceof Response ? result : Response.json(clone(result));
  };
  const adapter = createStripeAdapter({ secretKey: key, expectedAccountId: 'acct_synthetic', expectedLivemode: false,
    prices, fetchImpl, now: () => NOW * 1000, ...options });
  return { adapter, data, requests, routes };
}
const code = (promise, value) => assert.rejects(promise, error => error instanceof StripeAdapterError && error.code === value);
const snapshot = f => f.adapter.currentSubscriptionSnapshot(binding);
const grant = s => subscriptionEntitlement(s, binding, config, NOW);
const refund = (amount, status = 'succeeded') => ({ object: 'refund', id: 're_synthetic', charge: 'ch_synthetic', payment_intent: 'pi_synthetic', amount, currency: 'usd', status });
const dispute = status => ({ object: 'dispute', id: 'du_synthetic', charge: 'ch_synthetic', payment_intent: 'pi_synthetic', livemode: false, currency: 'usd', amount: 900, status });

test('factory is inert and rejects mode/account/key/price configuration errors', () => {
  const f = fixture(); assert.equal(f.requests.length, 0);
  for (const change of [{ secretKey: 'pk_test_fixture' }, { expectedLivemode: true }, { expectedAccountId: 'bad' },
    { prices: {} }, { prices: { monthly: { ...prices.monthly, interval: 'year' } } }]) assert.throws(() => fixture(change), StripeAdapterError);
});
test('account identity is pinned before operations; credentials cannot follow redirects', async () => {
  const f = fixture(); f.routes.set('GET /v1/account', { object: 'account', id: 'acct_wrong' });
  await code(f.adapter.retrieveCustomer(binding.customerId), 'stripe_account_mismatch');
  assert.equal(f.requests.length, 1);
  const redirect = fixture(); redirect.routes.set('GET /v1/account', new Response(null, { status: 302, headers: { location: 'https://example.invalid' } }));
  await code(redirect.adapter.retrieveCustomer(binding.customerId), 'stripe_http_error');
  assert.equal(redirect.requests.length, 1);
});
test('customer POST builds real form/idempotency headers and returns only binding metadata', async () => {
  const f = fixture(); f.data.customer.email = 'not-returned@example.invalid'; f.data.customer.address = { line1: 'Synthetic' };
  const result = await f.adapter.createCustomer({ email: 'synthetic@example.invalid', metadata: { firebaseUid: binding.uid, billingSchema: '1' } }, 'customer-v1:synthetic');
  const r = f.requests.at(-1);
  assert.equal(r.url.pathname, '/v1/customers'); assert.equal(r.method, 'POST');
  assert.equal(r.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(r.headers.get('idempotency-key'), 'customer-v1:synthetic');
  assert.equal(r.body.get('metadata[firebaseUid]'), binding.uid);
  assert.equal(r.body.get('email'), 'synthetic@example.invalid');
  assert.deepEqual(Object.keys(result).sort(), ['id', 'livemode', 'metadata']);
});
test('Checkout/Portal methods construct proper endpoints, nested values and subscription IDs', async () => {
  const f = fixture();
  const params = checkoutParameters(config, { uid: binding.uid }, binding.customerId, 'monthly');
  await f.adapter.createCheckoutSession(params, 'checkout-v1:monthly:synthetic');
  const r = f.requests.at(-1);
  assert.equal(r.url.pathname, '/v1/checkout/sessions');
  assert.equal(r.body.get('line_items[0][price]'), 'price_monthly');
  assert.equal(r.body.get('payment_method_types[0]'), 'card');
  assert.equal(r.body.get('subscription_data[metadata][firebaseUid]'), binding.uid);
  assert.equal(r.headers.get('idempotency-key'), 'checkout-v1:monthly:synthetic');
  f.data.checkout.subscription = { id: 'sub_synthetic' }; f.data.checkout.status = 'complete';
  assert.equal((await f.adapter.retrieveCheckoutSession('cs_test_synthetic')).subscription, 'sub_synthetic');
  await f.adapter.createPortalSession({ customer: binding.customerId, configuration: 'bpc_synthetic', return_url: 'https://example.invalid/account' });
  assert.equal(f.requests.at(-1).url.pathname, '/v1/billing_portal/sessions');
  assert.equal(f.requests.at(-1).body.get('configuration'), 'bpc_synthetic');
  assert.equal(f.requests.filter(r => r.url.pathname === '/v1/account').length, 1);
});
test('object IDs cannot inject paths; customer and returned session modes/identity are validated', async () => {
  const f = fixture(); await code(f.adapter.retrieveCustomer('cus_bad/../../charges'), 'stripe_invalid_identifier');
  assert.equal(f.requests.length, 1); // Account check only; no injected path request.
  for (const change of [{ livemode: true }, { deleted: true }, { id: 'cus_other' }]) {
    const g = fixture(); Object.assign(g.data.customer, change);
    await assert.rejects(g.adapter.retrieveCustomer(binding.customerId), StripeAdapterError);
  }
  const g = fixture(); g.data.checkout.mode = 'payment';
  await code(g.adapter.createCheckoutSession(checkoutParameters(config, { uid: binding.uid }, binding.customerId, 'monthly'), 'opaque-key'), 'stripe_checkout_shape_invalid');
});
test('real configured price is checked before Checkout POST; inactive or incorrect price never gets sold', async () => {
  for (const change of [{ active: false }, { currency: 'eur' }, { unit_amount: 1500 }, { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }]) {
    const f = fixture(); Object.assign(f.data.price, change);
    await code(f.adapter.createCheckoutSession(checkoutParameters(config, { uid: binding.uid }, binding.customerId, 'monthly'), 'opaque'), 'stripe_price_shape_unsupported');
    assert.equal(f.requests.some(r => r.method === 'POST'), false);
  }
});
test('portal configuration must allow cancellation at period end and disallow subscription changes', async () => {
  for (const changes of [{ subscription_update: { enabled: true } }, { subscription_cancel: { enabled: true, mode: 'immediately' } }, { payment_method_update: { enabled: false } }]) {
    const f = fixture(); f.routes.set('GET /v1/billing_portal/configurations/bpc_synthetic', { object: 'billing_portal.configuration', id: 'bpc_synthetic', livemode: false, active: true,
      features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, payment_method_update: { enabled: true }, ...changes } });
    await code(f.adapter.createPortalSession({ customer: binding.customerId, configuration: 'bpc_synthetic', return_url: 'https://example.invalid/account' }), 'stripe_portal_configuration_unsupported');
    assert.equal(f.requests.some(r => r.method === 'POST'), false);
  }
});

test('portal creation preserves an operator idempotency key across an uncertain retry', async () => {
  const f = fixture();
  const params = { customer: binding.customerId, configuration: 'bpc_synthetic', return_url: 'https://example.invalid/account' };
  f.routes.set('POST /v1/billing_portal/sessions', new Response('unavailable', { status: 503 }));
  await code(f.adapter.createPortalSession(params, 'portal:same-operation'), 'stripe_http_error');
  f.routes.set('POST /v1/billing_portal/sessions', () => f.data.portal);
  await f.adapter.createPortalSession(params, 'portal:same-operation');
  const posts = f.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map(r => r.headers.get('idempotency-key')), ['portal:same-operation', 'portal:same-operation']);
  assert.equal(posts[0].body.toString(), posts[1].body.toString());
});
test('all-status subscription pagination preserves customer filtering and does not stop at first page', async () => {
  const f = fixture();
  f.routes.set('GET /v1/subscriptions', r => {
    assert.equal(r.url.searchParams.get('status'), 'all'); assert.equal(r.url.searchParams.get('customer'), binding.customerId);
    assert.equal(r.url.searchParams.get('limit'), '100');
    return r.url.searchParams.has('starting_after') ? pageOf([{ ...f.data.subscription, id: 'sub_second', status: 'canceled' }]) : pageOf([f.data.subscription], true);
  });
  assert.deepEqual((await f.adapter.listAllSubscriptions(binding.customerId)).map(s => s.id), ['sub_synthetic', 'sub_second']);
  assert.equal(f.requests.at(-1).url.searchParams.get('starting_after'), 'sub_synthetic');
});
test('incomplete, duplicate, empty-more and page-budget lists throw rather than become no subscription', async () => {
  for (const value of [{ data: [] }, pageOf([], true), pageOf([{ id: 'sub_duplicate' }, { id: 'sub_duplicate' }])]) {
    const f = fixture(); f.routes.set('GET /v1/subscriptions', value);
    await code(f.adapter.listAllSubscriptions(binding.customerId), 'stripe_incomplete_list');
  }
  const f = fixture({ maxPages: 1 }); f.routes.set('GET /v1/subscriptions', pageOf([f.data.subscription], true));
  await code(f.adapter.listAllSubscriptions(binding.customerId), 'stripe_pagination_limit');
  const g = fixture(); g.routes.set('GET /v1/subscriptions', pageOf([g.data.subscription], true));
  await code(g.adapter.listAllSubscriptions(binding.customerId), 'stripe_incomplete_list');
});
test('successful card chain yields only normalized paid coverage using invoice LINE period', async () => {
  const f = fixture(), s = await snapshot(f);
  assert.equal(grant(s).active, true); assert.equal(s.currentPeriodEnd, NOW + 1000);
  assert.deepEqual(s.paidPeriods, [{ invoiceId: 'in_synthetic', subscriptionId: 'sub_synthetic', priceId: 'price_monthly', currency: 'usd',
    invoiceStatus: 'paid', successfulCharge: true, amountPaid: 900, amountRefunded: 0, disputeStatus: 'none', start: NOW - 1000, end: NOW + 1000 }]);
  assert.equal(s.paidPeriods[0].end === f.data.invoice.period_end, false);
  assert.equal(JSON.stringify(s).includes('payment_method'), false);
  const allocation = f.requests.find(r => r.url.pathname === '/v1/invoice_payments' && r.url.searchParams.has('payment[type]'));
  assert.equal(allocation.url.searchParams.get('payment[type]'), 'payment_intent');
  assert.equal(allocation.url.searchParams.get('payment[payment_intent]'), 'pi_synthetic');
});
test('fully empty canonical subscription list returns inactive state; lookup failure throws', async () => {
  const f = fixture(); f.data.subscriptions = [];
  const s = await snapshot(f); assert.equal(s.subscriptionId, null); assert.equal(grant(s).active, false);
  const g = fixture(); g.routes.set('GET /v1/subscriptions', new Response('provider private error', { status: 500 }));
  await code(snapshot(g), 'stripe_http_error');
});
test('old canceled subscription does not override the current active one; multiple live memberships block', async () => {
  const f = fixture(); f.data.subscriptions = [{ ...f.data.subscription, id: 'sub_old', status: 'canceled', created: NOW - 9000 }, f.data.subscription];
  assert.equal((await snapshot(f)).subscriptionId, 'sub_synthetic');
  f.data.subscriptions[0].status = 'past_due';
  await code(snapshot(f), 'stripe_multiple_memberships');
});
test('latest terminal subscription is retained for checkout retirement but never grants', async () => {
  const f = fixture(); f.data.subscription.status = 'canceled';
  f.data.subscriptions.unshift({ ...f.data.subscription, id: 'sub_old', created: NOW - 9000 });
  const s = await snapshot(f); assert.equal(s.subscriptionId, 'sub_synthetic'); assert.equal(grant(s).active, false);
  assert.equal(f.requests.some(r => r.url.pathname === '/v1/invoices'), false);
  f.data.subscriptions[0].created = f.data.subscription.created;
  await code(snapshot(f), 'stripe_ambiguous_membership');
});
test('customer/subscription UID, schema, mode and subscription item associations are strict', async () => {
  for (const mutate of [d => d.customer.metadata.firebaseUid = 'other', d => delete d.customer.metadata.billingSchema,
    d => d.subscription.metadata.firebaseUid = 'other', d => d.subscription.livemode = true,
    d => d.subscription.customer = 'cus_other', d => d.item.subscription = 'sub_other']) {
    const f = fixture(); mutate(f.data); await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('truncated subscription items are fetched fully and extra items are rejected', async () => {
  const f = fixture(); f.data.subscription.items.has_more = true;
  f.routes.set('GET /v1/subscription_items', pageOf([f.data.item, { ...f.data.item, id: 'si_extra' }]));
  await code(snapshot(f), 'stripe_subscription_shape_unsupported');
  const r = f.requests.at(-1); assert.equal(r.url.searchParams.get('subscription'), 'sub_synthetic');
});
test('unsupported price, quantity, trial, discount, tax, pause, proration schedule and manual collection block', async () => {
  for (const mutate of [d => d.item.quantity = 2, d => d.item.price = 'price_unknown', d => d.price.recurring.usage_type = 'metered',
    d => d.price.unit_amount = 500, d => d.price.currency = 'eur', d => d.price.transform_quantity = { divide_by: 2 },
    d => d.subscription.trial_end = NOW + 100, d => d.subscription.discounts = ['di_synthetic'],
    d => d.subscription.automatic_tax.enabled = true, d => d.subscription.pause_collection = { behavior: 'void' },
    d => d.subscription.schedule = 'sub_sched_synthetic', d => d.subscription.collection_method = 'send_invoice',
    d => d.subscription.pending_update = { expires_at: NOW + 100 }, d => delete d.item.current_period_end]) {
    const f = fixture(); mutate(f.data); await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('past_due retains only real paid coverage; open invoice and failed status never become paid', async () => {
  const f = fixture(); f.data.subscription.status = 'past_due'; assert.equal(grant(await snapshot(f)).active, true);
  f.data.invoice.status = 'open'; assert.equal(grant(await snapshot(f)).active, false);
  for (const status of ['trialing', 'incomplete', 'paused', 'unpaid']) {
    const g = fixture(); g.data.subscription.status = status; assert.equal(grant(await snapshot(g)).active, false);
  }
});
test('invoice list pagination can find paid coverage beyond an unpaid first page', async () => {
  const f = fixture();
  f.routes.set('GET /v1/invoices', r => r.url.searchParams.has('starting_after') ? pageOf([f.data.invoice]) : pageOf([{ ...f.data.invoice, id: 'in_open', status: 'open' }], true));
  assert.equal(grant(await snapshot(f)).active, true);
  const requests = f.requests.filter(r => r.url.pathname === '/v1/invoices');
  assert.equal(requests.length, 2); assert.equal(requests[1].url.searchParams.get('starting_after'), 'in_open');
  assert.equal(requests[1].url.searchParams.get('subscription'), 'sub_synthetic');
});
test('truncated invoice lines are fetched and multiple/prorated or mismatched recurring lines block', async () => {
  const f = fixture(); f.data.invoice.lines.has_more = true;
  f.routes.set('GET /v1/invoices/in_synthetic/lines', pageOf([f.data.line, { ...f.data.line, id: 'il_extra' }]));
  await code(snapshot(f), 'stripe_invoice_shape_unsupported');
  for (const mutate of [d => d.line.parent.subscription_item_details.proration = true,
    d => d.line.parent.subscription_item_details.subscription = 'sub_other', d => d.line.parent.subscription_item_details.subscription_item = 'si_other',
    d => d.line.pricing.price_details.price = 'price_other', d => d.line.quantity_decimal = '1.5',
    d => d.line.invoice = 'in_other', d => d.line.livemode = true, d => d.line.period.end = undefined]) {
    const g = fixture(); mutate(g.data); await assert.rejects(snapshot(g), StripeAdapterError);
  }
});
test('credits, manual payments, shipping, taxes, discounts, revisions and balance offsets are unsupported', async () => {
  for (const mutate of [d => d.invoice.post_payment_credit_notes_amount = 100, d => d.invoice.pre_payment_credit_notes_amount = 100,
    d => d.invoice.starting_balance = -100, d => d.invoice.amount_paid = 800, d => d.invoice.amount_overpaid = 1,
    d => d.invoice.billing_reason = 'subscription_update', d => d.invoice.collection_method = 'send_invoice',
    d => d.invoice.amount_shipping = 100, d => d.invoice.total_taxes = [{ amount: 10 }], d => d.invoice.discounts = ['di_synthetic'],
    d => d.invoice.latest_revision = 'in_revised', d => d.invoice.customer = 'cus_other']) {
    const f = fixture(); mutate(f.data); await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('one separately paid old refunded period cannot revoke current paid coverage', async () => {
  const f = fixture(), old = clone(f.data.invoice); old.id = 'in_old'; old.lines.data[0].id = 'il_old'; old.lines.data[0].invoice = old.id;
  old.lines.data[0].period = { start: NOW - 90000, end: NOW - 80000 };
  f.data.invoices.unshift(old);
  assert.equal(grant(await snapshot(f)).active, true);
  assert.equal(f.requests.some(r => r.url.searchParams.get('invoice') === old.id), false);
});
test('invoice payment pagination includes canceled attempts but requires exactly one paid allocation', async () => {
  const f = fixture();
  f.routes.set('GET /v1/invoice_payments', r => {
    if (r.url.searchParams.has('payment[type]')) return pageOf([f.data.payment]);
    return r.url.searchParams.has('starting_after') ? pageOf([f.data.payment]) : pageOf([{ ...f.data.payment, id: 'inpay_canceled', status: 'canceled' }], true);
  });
  assert.equal(grant(await snapshot(f)).active, true);
  f.routes.set('GET /v1/invoice_payments', pageOf([f.data.payment, { ...f.data.payment, id: 'inpay_extra' }]));
  await code(snapshot(f), 'stripe_payment_shape_unsupported');
});
test('shared PaymentIntent, mismatched invoice, unknown external record and incomplete allocation lists block', async () => {
  const f = fixture(); f.routes.set('GET /v1/invoice_payments', r => pageOf(r.url.searchParams.has('payment[type]')
    ? [f.data.payment, { ...f.data.payment, id: 'inpay_other', invoice: 'in_other' }] : [f.data.payment]));
  await code(snapshot(f), 'stripe_shared_payment_unsupported');
  for (const change of [{ invoice: 'in_other' }, { payment: { type: 'payment_record', payment_record: 'pyr_synthetic' } }, { amount_paid: 800 }, { livemode: true }]) {
    const g = fixture(); Object.assign(g.data.payment, change); await assert.rejects(snapshot(g), StripeAdapterError);
  }
});
test('successful invoice alone is insufficient: actual PI/card charge and amount must agree', async () => {
  for (const mutate of [d => d.intent.customer = 'cus_other', d => d.intent.status = 'processing', d => d.intent.amount_received = 800,
    d => d.intent.latest_charge = 'ch_other', d => d.intent.capture_method = 'manual', d => d.intent.payment_method_types = ['link'],
    d => d.charge.paid = false, d => d.charge.captured = false, d => d.charge.amount_captured = 100, d => d.charge.payment_method_details.type = 'us_bank_account',
    d => d.charge.payment_intent = 'pi_other', d => d.charge.customer = 'cus_other', d => d.charge.status = 'pending']) {
    const f = fixture(); mutate(f.data); await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('charges paginate past failed attempts; more than one successful charge is unsupported', async () => {
  const f = fixture();
  f.routes.set('GET /v1/charges', r => r.url.searchParams.has('starting_after') ? pageOf([f.data.charge])
    : pageOf([{ ...f.data.charge, id: 'ch_failed', status: 'failed', paid: false }], true));
  assert.equal(grant(await snapshot(f)).active, true);
  f.routes.set('GET /v1/charges', pageOf([f.data.charge, { ...f.data.charge, id: 'ch_extra' }]));
  await code(snapshot(f), 'stripe_charge_shape_unsupported');
});
test('fully paginated successful refunds revoke full coverage; partial refunds retain coverage', async () => {
  for (const [amount, active] of [[900, false], [100, true]]) {
    const f = fixture(); f.data.refunds = [refund(amount)]; f.data.charge.amount_refunded = amount;
    assert.equal(grant(await snapshot(f)).active, active);
  }
  const f = fixture(); f.data.charge.amount_refunded = 900;
  f.routes.set('GET /v1/refunds', r => r.url.searchParams.has('starting_after') ? pageOf([{ ...refund(500), id: 're_second' }]) : pageOf([refund(400)], true));
  assert.equal(grant(await snapshot(f)).active, false);
  assert.equal(f.requests.filter(r => r.url.pathname === '/v1/refunds').length, 2);
});
test('pending/failed refunds do not count as settled refunds; unknown or foreign refunds block', async () => {
  for (const status of ['pending', 'requires_action', 'failed', 'canceled']) {
    const f = fixture(); f.data.refunds = [refund(900, status)]; assert.equal(grant(await snapshot(f)).active, true);
  }
  for (const change of [{ status: 'unknown' }, { charge: 'ch_other' }, { payment_intent: 'pi_other' }, { customer: 'cus_other' }, { amount: 901 }]) {
    const f = fixture(); f.data.refunds = [{ ...refund(900), ...change }]; await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('refunded charge aggregate and fully retrieved successful refunds must agree before granting', async () => {
  const f = fixture(); f.data.charge.amount_refunded = 900;
  await code(snapshot(f), 'stripe_refund_evidence_inconsistent');
  const g = fixture(); g.data.refunds = [refund(100)];
  await code(snapshot(g), 'stripe_refund_evidence_inconsistent');
});
test('all dispute pages are inspected: open/lost/warnings block, only won restores', async () => {
  for (const status of ['needs_response', 'under_review', 'lost', 'warning_needs_response', 'warning_under_review', 'warning_closed', 'prevented', 'won']) {
    const f = fixture(); f.data.charge.disputed = true; f.data.disputes = [dispute(status)];
    assert.equal(grant(await snapshot(f)).active, status === 'won');
  }
  const f = fixture(); f.data.charge.disputed = true;
  f.routes.set('GET /v1/disputes', r => r.url.searchParams.has('starting_after') ? pageOf([{ ...dispute('lost'), id: 'du_second' }]) : pageOf([dispute('won')], true));
  assert.equal(grant(await snapshot(f)).active, false);
  const g = fixture(); g.data.charge.disputed = true;
  await code(snapshot(g), 'stripe_dispute_evidence_missing');
});
test('unsupported dispute status, mode and charge relationship fail closed', async () => {
  for (const change of [{ status: 'unexpected' }, { livemode: true }, { charge: 'ch_other' }, { currency: 'eur' }]) {
    const f = fixture(); f.data.disputes = [{ ...dispute('won'), ...change }]; await assert.rejects(snapshot(f), StripeAdapterError);
  }
});
test('overlapping current paid recurring invoices require reconciliation', async () => {
  const f = fixture(), other = clone(f.data.invoice); other.id = 'in_second'; other.lines.data[0].id = 'il_second'; other.lines.data[0].invoice = other.id;
  f.data.invoices.push(other);
  f.routes.set('GET /v1/invoice_payments', r => {
    if (r.url.searchParams.has('payment[type]')) {
      const last = f.requests.filter(x => x.url.pathname === '/v1/invoice_payments' && x.url.searchParams.has('invoice')).at(-1);
      const id = last.url.searchParams.get('invoice'); return pageOf([{ ...f.data.payment, id: id === 'in_second' ? 'inpay_second' : 'inpay_synthetic', invoice: id }]);
    }
    const id = r.url.searchParams.get('invoice'); return pageOf([{ ...f.data.payment, id: id === 'in_second' ? 'inpay_second' : 'inpay_synthetic', invoice: id }]);
  });
  await code(snapshot(f), 'stripe_overlapping_paid_periods');
});
test('each supported event family resolves through fresh provider objects, not stale event snapshots', async () => {
  const cases = [
    ['checkout.session.completed', 'cs_test_synthetic'], ['customer.subscription.updated', 'sub_synthetic'],
    ['invoice.payment_failed', 'in_synthetic'], ['charge.refunded', 'ch_synthetic'],
    ['refund.updated', 're_synthetic'], ['charge.dispute.closed', 'du_synthetic'],
  ];
  for (const [type, objectId] of cases) {
    const f = fixture(); f.routes.set('GET /v1/refunds/re_synthetic', refund(100)); f.routes.set('GET /v1/disputes/du_synthetic', dispute('won'));
    const result = await f.adapter.resolveEventCustomer({ type, objectId, livemode: false, data: { object: { customer: 'cus_attacker' } } });
    assert.equal(result.customerId, binding.customerId); assert.equal(result.customer.metadata.firebaseUid, binding.uid);
    assert.equal('unrelated' in result, false);
  }
});
test('event mode/ID and refund-dispute relationships must be proven; unknown customer is never unrelated', async () => {
  const f = fixture(); await code(f.adapter.resolveEventCustomer({ type: 'invoice.paid', objectId: 'in_synthetic', livemode: true }), 'stripe_event_scope_invalid');
  await code(f.adapter.resolveEventCustomer({ type: 'unsupported.event', objectId: 'ch_synthetic', livemode: false }), 'stripe_event_scope_invalid');
  f.routes.set('GET /v1/refunds/re_synthetic', { ...refund(100), customer: 'cus_other' });
  await code(f.adapter.resolveEventCustomer({ type: 'refund.created', objectId: 're_synthetic', livemode: false }), 'stripe_event_relationship_invalid');
  const g = fixture(); g.data.customer.metadata = {};
  const result = await g.adapter.resolveEventCustomer({ type: 'charge.refunded', objectId: 'ch_synthetic', livemode: false });
  assert.equal(result.customerId, binding.customerId); assert.equal(result.customer.metadata.firebaseUid, undefined); assert.equal('unrelated' in result, false);
});
test('HTTP errors are sanitized and retry hints are bounded; no inline repeated financial POST', async () => {
  const f = fixture(); f.routes.set('POST /v1/customers', new Response('secret provider message', { status: 429, headers: { 'Retry-After': '99999' } }));
  await assert.rejects(f.adapter.createCustomer({ email: 'synthetic@example.invalid', metadata: { firebaseUid: binding.uid, billingSchema: '1' } }, 'opaque'), e =>
    e.code === 'stripe_http_error' && e.status === 429 && e.retryable === true && e.retryAfterSeconds === 3600 && !e.message.includes('secret'));
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});
test('malformed, oversized and timed-out responses cannot become successful empty retrievals', async () => {
  const malformed = fixture(); malformed.routes.set('GET /v1/subscriptions', new Response('{bad', { headers: { 'Content-Type': 'application/json' } }));
  await code(malformed.adapter.listAllSubscriptions(binding.customerId), 'stripe_invalid_json');
  const huge = fixture({ maxResponseBytes: 100 }); huge.routes.set('GET /v1/subscriptions', new Response('x'.repeat(101)));
  await code(huge.adapter.listAllSubscriptions(binding.customerId), 'stripe_response_too_large');
  const timeout = fixture({ timeoutMs: 5 }); timeout.routes.set('GET /v1/subscriptions', r => new Promise((_, reject) => r.init.signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true })));
  await code(timeout.adapter.listAllSubscriptions(binding.customerId), 'stripe_timeout');
});
test('operation request budget fails closed rather than using a partial payment graph', async () => {
  const f = fixture({ maxRequests: 4 }); await code(snapshot(f), 'stripe_operation_limit');
  assert.equal(f.requests.length, 4);
});
test('shared expired/aborted workflow rejects before even the account request', async () => {
  const controller = new AbortController();
  const expired = fixture({ getOperationContext: () => ({ signal: controller.signal, deadline: NOW * 1000 }) });
  await code(expired.adapter.retrieveCustomer(binding.customerId), 'stripe_operation_limit');
  assert.equal(expired.requests.length, 0);
  controller.abort();
  const aborted = fixture({ getOperationContext: () => ({ signal: controller.signal, deadline: NOW * 1000 + 10000 }) });
  await code(aborted.adapter.retrieveCustomer(binding.customerId), 'stripe_operation_aborted');
  assert.equal(aborted.requests.length, 0);
});
test('shared cancellation aborts in-flight fetch and prevents later payment-graph requests', async () => {
  const controller = new AbortController();
  const f = fixture({ getOperationContext: () => ({ signal: controller.signal, deadline: NOW * 1000 + 10000 }) });
  f.routes.set('GET /v1/refunds', r => new Promise((_, reject) => {
    r.init.signal.addEventListener('abort', () => reject(new Error('synthetic workflow abort')), { once: true });
    controller.abort();
  }));
  await code(snapshot(f), 'stripe_operation_aborted');
  assert.equal(f.requests.at(-1).url.pathname, '/v1/refunds');
  assert.equal(f.requests.some(r => r.url.pathname === '/v1/disputes'), false);
  const count = f.requests.length;
  await code(f.adapter.retrieveCustomer(binding.customerId), 'stripe_operation_aborted');
  assert.equal(f.requests.length, count);
});
test('shared deadline caps an otherwise longer request timeout', async () => {
  const controller = new AbortController();
  const f = fixture({ now: () => Date.now(), timeoutMs: 5000,
    getOperationContext: () => ({ signal: controller.signal, deadline: Date.now() + 10 }) });
  f.routes.set('GET /v1/subscriptions', r => new Promise((_, reject) => r.init.signal.addEventListener('abort', () => reject(new Error('synthetic deadline abort')), { once: true })));
  const start = Date.now();
  await assert.rejects(f.adapter.listAllSubscriptions(binding.customerId), e => ['stripe_timeout', 'stripe_operation_limit'].includes(e.code));
  assert.ok(Date.now() - start < 1000);
  assert.equal(f.requests.at(-1).init.signal.aborted, true);
});
test('cached factory reads a new shared workflow context for every operation', async () => {
  let current = null;
  const f = fixture({ getOperationContext: () => current });
  await f.adapter.retrieveCustomer(binding.customerId);
  const controller = new AbortController(); controller.abort();
  current = { signal: controller.signal, deadline: NOW * 1000 + 10000 };
  const count = f.requests.length;
  await code(f.adapter.retrieveCustomer(binding.customerId), 'stripe_operation_aborted');
  assert.equal(f.requests.length, count);
  current = { signal: new AbortController().signal, deadline: NOW * 1000 + 10000 };
  await f.adapter.retrieveCustomer(binding.customerId);
  assert.equal(f.requests.length, count + 1);
});
test('shared cancellation also cancels a stalled response body after headers arrived', async () => {
  const controller = new AbortController(); let bodyCanceled = false;
  const f = fixture({ getOperationContext: () => ({ signal: controller.signal, deadline: NOW * 1000 + 10000 }) });
  f.routes.set(`GET /v1/customers/${binding.customerId}`, () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{"object":')); setTimeout(() => controller.abort(), 2); },
    cancel() { bodyCanceled = true; },
  })));
  await code(f.adapter.retrieveCustomer(binding.customerId), 'stripe_operation_aborted');
  assert.equal(bodyCanceled, true);
});

const lifetimePrice = {id:'price_lifetime',currency:'usd',interval:null,intervalCount:0,unitAmount:2900};
function lifetimeFixture(options={}){
 const f=fixture({prices:{...prices,lifetime:lifetimePrice},...options});
 Object.assign(f.data.checkout,{mode:'payment',status:'complete',payment_status:'paid',payment_intent:'pi_synthetic',metadata:{firebaseUid:binding.uid,billingSchema:'1',plan:'lifetime'},currency:'usd',amount_total:2900,amount_subtotal:2900,total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},automatic_tax:{enabled:false}});
 Object.assign(f.data.intent,{amount:2900,amount_received:2900,metadata:{firebaseUid:binding.uid,billingSchema:'1',plan:'lifetime'}});
 Object.assign(f.data.charge,{amount:2900,amount_captured:2900});
 f.data.lifetimeLine={object:'item',id:'li_synthetic',price:'price_lifetime',quantity:1,currency:'usd',amount_subtotal:2900,amount_total:2900,amount_discount:0,amount_tax:0};
 f.routes.set('GET /v1/checkout/sessions',()=>pageOf([f.data.checkout]));
 f.routes.set('GET /v1/checkout/sessions/cs_test_synthetic/line_items',()=>pageOf([f.data.lifetimeLine]));
 f.routes.set('GET /v1/prices/price_lifetime',()=>({...f.data.price,id:'price_lifetime',type:'one_time',recurring:null,unit_amount:2900,unit_amount_decimal:'2900'}));
 f.data.subscriptions=[];
 return f;
}
test('lifetime requires paid checkout and canonical intent/charge; subscription events cannot remove it',async()=>{
 const f=lifetimeFixture();f.data.subscriptions=[{...f.data.subscription,status:'canceled'}];
 const result=await snapshot(f);
 assert.equal(result.plan,'lifetime');assert.equal(result.amountPaid,2900);
 const access=subscriptionEntitlement(result,binding,{...config,prices:{...prices,lifetime:lifetimePrice}},NOW);
 assert.equal(access.active,true);assert.equal(access.currentPeriodEnd,0);assert.equal(access.reason,'paid_lifetime');
 assert.equal(f.requests.some(r=>r.url.pathname==='/v1/subscriptions'),false);
});
test('one-time checkout uses approved lifetime price and binds payment metadata',async()=>{
 const f=lifetimeFixture();f.data.checkout.status='open';
 const params=checkoutParameters({...config,prices:{...prices,lifetime:lifetimePrice}}, {uid:binding.uid},binding.customerId,'lifetime');
 assert.equal(params.mode,'payment');assert.equal(params.subscription_data,undefined);assert.equal(params.payment_intent_data.metadata.plan,'lifetime');
 assert.equal((await f.adapter.createCheckoutSession(params,'lifetime-fixture')).mode,'payment');
});
test('unpaid, fully refunded and disputed lifetime payments do not grant access; partial refund retains it',async()=>{
 for(const kind of ['unpaid','refund','dispute']){
  const f=lifetimeFixture();
  if(kind==='unpaid')f.data.checkout.payment_status='unpaid';
  if(kind==='refund'){f.data.charge.amount_refunded=2900;f.data.refunds=[{object:'refund',id:'re_synthetic',charge:'ch_synthetic',payment_intent:'pi_synthetic',currency:'usd',amount:2900,status:'succeeded'}];}
  if(kind==='dispute'){f.data.charge.disputed=true;f.data.disputes=[{object:'dispute',id:'du_synthetic',livemode:false,charge:'ch_synthetic',payment_intent:'pi_synthetic',currency:'usd',amount:2900,status:'lost'}];}
  assert.notEqual((await snapshot(f)).plan,'lifetime',kind);
 }
 const partial=lifetimeFixture();partial.data.charge.amount_refunded=500;partial.data.refunds=[{object:'refund',id:'re_synthetic',charge:'ch_synthetic',currency:'usd',amount:500,status:'succeeded'}];
 assert.equal((await snapshot(partial)).plan,'lifetime');
});
test('lifetime mismatches fail closed across identity, mode, currency, line amount and payment evidence',async()=>{
 for(const mutate of [f=>f.data.checkout.client_reference_id='other',f=>f.data.checkout.customer='cus_other',f=>f.data.checkout.livemode=true,f=>f.data.checkout.amount_total=1,f=>f.data.checkout.currency='eur',f=>f.data.lifetimeLine.price='price_other',f=>f.data.lifetimeLine.quantity=2,f=>f.data.intent.metadata.firebaseUid='other',f=>f.data.intent.status='processing',f=>f.data.charge.amount_captured=1]){
  const f=lifetimeFixture();mutate(f);await assert.rejects(snapshot(f));
 }
});

function recoveryFixture(){
 const f=lifetimeFixture({recoveryCouponId:'recovery50'});
 Object.assign(f.data.checkout,{amount_total:1450,discounts:[{coupon:'recovery50'}]});
 f.data.checkout.metadata.recoveryOffer='lifetime50v1';f.data.checkout.total_details.amount_discount=1450;
 Object.assign(f.data.lifetimeLine,{amount_total:1450,amount_discount:1450});
 Object.assign(f.data.intent,{amount:1450,amount_received:1450});Object.assign(f.data.charge,{amount:1450,amount_captured:1450});return f;
}
test('approved recovery coupon grants lifetime only for verified discounted charge',async()=>{
 const f=recoveryFixture();const paid=await snapshot(f);assert.equal(paid.amountPaid,1450);
 const conf={...config,recoveryCouponId:'recovery50',prices:{...prices,lifetime:lifetimePrice}};
 assert.equal(subscriptionEntitlement(paid,binding,conf,NOW).active,true);
 assert.equal(subscriptionEntitlement(paid,binding,{...conf,recoveryCouponId:'other'},NOW).active,false);
 assert.equal(subscriptionEntitlement({...paid,recoveryCouponId:undefined},binding,conf,NOW).active,false);
});
test('unapproved coupon, wrong amount, missing marker and wrong payment cannot grant recovery access',async()=>{
 for(const mutate of [f=>f.data.checkout.discounts[0].coupon='other',f=>f.data.checkout.amount_total=1400,f=>delete f.data.checkout.metadata.recoveryOffer,f=>f.data.charge.amount_captured=1400,f=>f.data.checkout.discounts.push({coupon:'recovery50'})]){const f=recoveryFixture();mutate(f);await assert.rejects(snapshot(f));}
});

function regionalFixture(amount=1900,country='ES',tier='middle') {
 const offers={middle:{amount:1900,couponId:'regional19'},value:{amount:1450,couponId:'regional1450'}};
 const f=lifetimeFixture({regionalOffers:offers});const coupon=offers[tier].couponId;
 Object.assign(f.data.checkout,{amount_total:amount,discounts:[{coupon}]});
 Object.assign(f.data.checkout.metadata,{market_version:'regional-v1',market_country:country,market_tier:tier});
 f.data.checkout.total_details.amount_discount=2900-amount;
 Object.assign(f.data.lifetimeLine,{amount_total:amount,amount_discount:2900-amount});
 Object.assign(f.data.intent,{amount,amount_received:amount});Object.assign(f.data.charge,{amount,amount_captured:amount});
 return {f,conf:{...config,regionalOffers:offers,prices:{...prices,lifetime:lifetimePrice}}};
}
test('both regional payments grant durable lifetime access with exact canonical payment evidence',async()=>{
 for(const args of [[1900,'ES','middle'],[1450,'BR','value']]){
  const {f,conf}=regionalFixture(...args);const paid=await snapshot(f);
  assert.equal(subscriptionEntitlement(paid,binding,conf,NOW).active,true);
  assert.equal(subscriptionEntitlement({...paid,regionalCouponId:'wrong'},binding,conf,NOW).active,false);
 }
});
test('regional mismatch or stacking cannot grant lifetime',async()=>{
 for(const mutate of [f=>f.data.checkout.metadata.market_country='US',f=>f.data.checkout.discounts[0].coupon='other',f=>f.data.checkout.metadata.recoveryOffer='lifetime50v1',f=>f.data.charge.amount_captured=1]){
  const {f}=regionalFixture();mutate(f);await assert.rejects(snapshot(f));
 }
});

 test('discounted checkouts omit conflicting promotion flag even for saved legacy reservations',async()=>{
  for(const kind of ['regional','recovery']) {
   const offers={value:{amount:1450,couponId:'regional1450'}};
   const f=lifetimeFixture({regionalOffers:offers,recoveryCouponId:'recovery50'});
   f.data.checkout.status='open';f.data.checkout.url='https://checkout.stripe.com/c/pay/synthetic';
   const p=checkoutParameters({...config,prices:{...prices,lifetime:lifetimePrice}},{uid:binding.uid},binding.customerId,'lifetime');
   if(kind==='regional')Object.assign(p.metadata,{market_version:'regional-v1',market_country:'BR',market_tier:'value'});
   else p.metadata.recoveryOffer='lifetime50v1';
   p.discounts=[{coupon:kind==='regional'?'regional1450':'recovery50'}];
   const before=clone(p);
   f.routes.set('POST /v1/checkout/sessions',r=>{assert.equal(r.body.has('allow_promotion_codes'),false);assert.equal(r.body.get('discounts[0][coupon]'),p.discounts[0].coupon);return f.data.checkout;});
   await f.adapter.createCheckoutSession(p,'regression-discount');assert.deepEqual(p,before);
  }
 });
function supportFixture(){
 const supportOffers={thanks10:{uid:binding.uid,couponId:'support10',amount:1305}};
 const f=lifetimeFixture({supportOffers});
 Object.assign(f.data.checkout.metadata,{support_offer:'thanks10'});f.data.checkout.discounts=[{coupon:'support10'}];
 f.data.checkout.amount_total=1305;f.data.checkout.total_details.amount_discount=1595;
 f.data.lifetimeLine.amount_total=1305;f.data.lifetimeLine.amount_discount=1595;
 f.data.intent.amount=f.data.intent.amount_received=1305;f.data.charge.amount=f.data.charge.amount_captured=1305;
 return {f,conf:{...config,supportOffers,prices:{...prices,lifetime:lifetimePrice}}};
}
test('customer-specific support discount grants verified lifetime only to the bound account',async()=>{
 const {f,conf}=supportFixture();const paid=await snapshot(f);assert.equal(subscriptionEntitlement(paid,binding,conf,NOW).active,true);
 assert.equal(subscriptionEntitlement({...paid,supportMetadata:{...paid.supportMetadata,firebaseUid:'someoneElse'}},binding,conf,NOW).active,false);
 assert.equal(subscriptionEntitlement({...paid,amountPaid:100},binding,conf,NOW).active,false);
});
test('support coupon mismatch, unknown offer, wrong owner and stacking are rejected',async()=>{
 for(const mutate of [f=>f.data.checkout.discounts[0].coupon='wrong',f=>f.data.checkout.metadata.support_offer='unknown',f=>f.data.checkout.metadata.firebaseUid='someoneElse',f=>f.data.checkout.metadata.recoveryOffer='lifetime50v1']){
 const {f}=supportFixture();mutate(f);await assert.rejects(snapshot(f));}
});
