/** Stripe HTTP boundary only. No credentials, deployment, or network activity at import/factory time. */
import { SUPPORTED_EVENTS } from '../core.mjs';

export const STRIPE_API_VERSION = '2026-08-26.dahlia';
const API_ORIGIN = 'https://api.stripe.com';
const TERMINAL = new Set(['canceled', 'incomplete_expired']);
const SUB_STATUSES = new Set(['active', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'paused', 'unpaid', 'canceled']);
const INVOICE_STATUSES = new Set(['draft', 'open', 'paid', 'uncollectible', 'void']);
const REFUND_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
const DISPUTE_STATUSES = new Set(['warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const idOf = value => typeof value === 'string' ? value : value?.id;
const idValid = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,180}$`).test(value);
const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const empty = value => value === null || value === undefined || (Array.isArray(value) && value.length === 0);
const equalMoney = (...values) => values.every(value => integer(value) && value > 0 && value === values[0]);

/** Error fields are safe operational categories, never Stripe messages/bodies. */
export class StripeAdapterError extends Error {
  constructor(code, { status = 503, retryable = false, retryAfterSeconds = null } = {}) {
    super(code); this.name = 'StripeAdapterError'; this.code = code;
    this.status = status; this.retryable = retryable; this.retryAfterSeconds = retryAfterSeconds;
  }
}
const fail = (code, options) => { throw new StripeAdapterError(code, options); };
const demand = (condition, code = 'stripe_unsupported_shape') => { if (!condition) fail(code); };
const requireId = (value, prefix) => { demand(idValid(value, prefix), 'stripe_invalid_identifier'); return value; };

function encodeForm(value, prefix = '', output = new URLSearchParams()) {
  if (value === undefined) return output;
  if (value === null) { output.append(prefix, ''); return output; }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) encodeForm(child, prefix ? `${prefix}[${key}]` : key, output);
  } else {
    demand(['string', 'number', 'boolean'].includes(typeof value), 'stripe_invalid_parameters');
    output.append(prefix, String(value));
  }
  return output;
}

async function boundedJson(response, maxBytes, signal) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body?.cancel(); fail('stripe_response_too_large'); }
  const reader = response.body?.getReader();
  demand(reader, 'stripe_invalid_response');
  const chunks = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); fail('stripe_response_too_large'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('stripe_invalid_json'); }
}

/**
 * All options are private, server-owned configuration. Inject fetchImpl in tests.
 * Requests are bounded; a retryable error is handed to the durable coordinator,
 * never hidden by a retry with a new creation key. See stripe.md for the contract.
 */
export function createStripeAdapter({ secretKey, expectedAccountId, expectedLivemode, prices,
  fetchImpl = globalThis.fetch, timeoutMs = 5000, operationTimeoutMs = 20000,
  maxPages = 20, maxRequests = 100, maxResponseBytes = 2_097_152, now = () => Date.now(), getOperationContext = () => null } = {}) {
  demand(typeof expectedLivemode === 'boolean' && typeof secretKey === 'string'
    && new RegExp(`^(sk|rk)_${expectedLivemode ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(secretKey)
    && idValid(expectedAccountId, 'acct') && typeof fetchImpl === 'function' && typeof getOperationContext === 'function', 'stripe_not_configured');
  demand(integer(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000
    && integer(operationTimeoutMs) && operationTimeoutMs >= timeoutMs && operationTimeoutMs <= 25000
    && integer(maxPages) && maxPages > 0 && maxPages <= 100
    && integer(maxRequests) && maxRequests > 0 && maxRequests <= 500
    && integer(maxResponseBytes) && maxResponseBytes > 0 && maxResponseBytes <= 4_194_304, 'stripe_invalid_limits');
  const approved = new Map();
  for (const plan of ['monthly', 'annual', 'lifetime']) {
    const p = prices?.[plan];
    if (!p) continue;
    demand(idValid(p.id, 'price') && p.currency === 'usd' && (plan === 'lifetime' ? p.interval === null && p.intervalCount === 0 && p.unitAmount === 2900 : p.interval === (plan === 'monthly' ? 'month' : 'year') && p.intervalCount === 1)
      && (p.unitAmount === undefined || (integer(p.unitAmount) && p.unitAmount > 0)), 'stripe_price_not_configured');
    demand(!approved.has(p.id), 'stripe_price_not_configured');
    approved.set(p.id, { ...p, plan });
  }
  demand(approved.size > 0, 'stripe_price_not_configured');
  let accountChecked = false;

  function checkOperation(ctx) {
    if (ctx.signal?.aborted) fail('stripe_operation_aborted', { retryable: true });
    if (now() >= ctx.deadline) fail('stripe_operation_limit', { retryable: true });
  }

  async function request(ctx, method, path, params = {}, idempotencyKey) {
    demand(/^\/v1\/[A-Za-z0-9_/-]+$/.test(path), 'stripe_invalid_path');
    checkOperation(ctx);
    if (++ctx.requests > maxRequests) fail('stripe_operation_limit', { retryable: true });
    const url = new URL(path, API_ORIGIN);
    const headers = { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': STRIPE_API_VERSION, Accept: 'application/json' };
    const form = encodeForm(params);
    if (method === 'GET') url.search = form.toString();
    else headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey !== undefined) {
      demand(typeof idempotencyKey === 'string' && /^[A-Za-z0-9:_-]{1,255}$/.test(idempotencyKey), 'stripe_invalid_idempotency_key');
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    ctx.signal?.addEventListener('abort', abort, { once: true });
    if (ctx.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, ctx.deadline - now()));
    try {
      checkOperation(ctx);
      const response = await fetchImpl(url.href, { method, headers, ...(method === 'POST' ? { body: form.toString() } : {}), signal: controller.signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      if (ctx.signal?.aborted || now() >= ctx.deadline) { await response.body?.cancel(); checkOperation(ctx); }
      if (!response.ok) {
        await response.body?.cancel();
        const retryAfter = response.headers.get('retry-after');
        fail('stripe_http_error', { status: response.status, retryable: response.status === 429 || response.status >= 500,
          retryAfterSeconds: /^\d+$/.test(retryAfter || '') ? Math.min(Number(retryAfter), 3600) : null });
      }
      const result = await boundedJson(response, maxResponseBytes, controller.signal);
      checkOperation(ctx);
      return result;
    } catch (error) {
      if (error instanceof StripeAdapterError) throw error;
      fail(ctx.signal?.aborted ? 'stripe_operation_aborted' : controller.signal.aborted ? 'stripe_timeout' : 'stripe_transport_error', { retryable: true });
    } finally { clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); }
  }
  async function checkAccount(ctx) {
    if (accountChecked) return;
    const account = await request(ctx, 'GET', '/v1/account');
    demand(account?.object === 'account' && account.id === expectedAccountId, 'stripe_account_mismatch');
    accountChecked = true;
  }
  const operation = fn => async (...args) => {
    const shared = getOperationContext();
    demand(shared == null || (integer(shared.deadline) && typeof shared.signal?.aborted === 'boolean'
      && typeof shared.signal.addEventListener === 'function' && typeof shared.signal.removeEventListener === 'function'), 'stripe_operation_context_invalid');
    const ctx = { requests: 0, deadline: Math.min(now() + operationTimeoutMs, shared?.deadline ?? Infinity), signal: shared?.signal };
    checkOperation(ctx);
    await checkAccount(ctx);
    const result = await fn(ctx, ...args);
    checkOperation(ctx);
    return result;
  };
  function scoped(object, kind, prefix, expectedId) {
    demand(object && object.object === kind && idValid(object.id, prefix)
      && (!expectedId || object.id === expectedId) && object.livemode === expectedLivemode, 'stripe_object_scope_invalid');
    return object;
  }
  function listShape(value) {
    demand(value?.object === 'list' && Array.isArray(value.data) && typeof value.has_more === 'boolean', 'stripe_incomplete_list');
    return value;
  }
  async function list(ctx, path, params = {}) {
    const values = [], ids = new Set(); let cursor;
    for (let page = 0; page < maxPages; page++) {
      const batch = listShape(await request(ctx, 'GET', path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }));
      for (const item of batch.data) {
        demand(typeof item?.id === 'string' && !ids.has(item.id), 'stripe_incomplete_list');
        ids.add(item.id); values.push(item);
      }
      if (!batch.has_more) return values;
      demand(batch.data.length > 0, 'stripe_incomplete_list');
      cursor = batch.data.at(-1).id;
    }
    fail('stripe_pagination_limit', { retryable: true });
  }
  async function embeddedOrList(ctx, embedded, path, params) {
    const value = listShape(embedded);
    return value.has_more ? list(ctx, path, params) : value.data;
  }
  async function customer(ctx, customerId) {
    requireId(customerId, 'cus');
    const c = await request(ctx, 'GET', `/v1/customers/${customerId}`);
    demand(c?.deleted !== true, 'stripe_customer_deleted');
    scoped(c, 'customer', 'cus', customerId);
    return { id: c.id, livemode: c.livemode, metadata: { firebaseUid: c.metadata?.firebaseUid, billingSchema: c.metadata?.billingSchema } };
  }
  async function boundCustomer(ctx, binding) {
    demand(uidValid(binding?.uid) && idValid(binding?.customerId, 'cus'), 'stripe_binding_invalid');
    const c = await customer(ctx, binding.customerId);
    demand(c.metadata.firebaseUid === binding.uid && c.metadata.billingSchema === '1', 'stripe_binding_invalid');
    return c;
  }
  function checkSubscription(s, customerId) {
    scoped(s, 'subscription', 'sub');
    demand(idOf(s.customer) === customerId && SUB_STATUSES.has(s.status) && integer(s.created), 'stripe_subscription_scope_invalid');
    return s;
  }
  async function subscriptions(ctx, customerId) {
    requireId(customerId, 'cus');
    return (await list(ctx, '/v1/subscriptions', { customer: customerId, status: 'all' })).map(s => checkSubscription(s, customerId));
  }
  async function retrieveSubscription(ctx, subscriptionId, customerId) {
    requireId(subscriptionId, 'sub');
    const s = checkSubscription(await request(ctx, 'GET', `/v1/subscriptions/${subscriptionId}`), customerId);
    demand(s.id === subscriptionId, 'stripe_object_scope_invalid');
    return s;
  }
  async function validatedPrice(ctx, priceId, forSale = false) {
    requireId(priceId, 'price');
    const expectedPrice = approved.get(priceId);
    demand(expectedPrice, 'stripe_unapproved_price');
    const price = scoped(await request(ctx, 'GET', `/v1/prices/${priceId}`), 'price', 'price', priceId);
    demand((expectedPrice.plan === 'lifetime' ? price.type === 'one_time' && price.recurring == null : price.type === 'recurring' && price.recurring?.interval === expectedPrice.interval && price.recurring.interval_count === 1 && price.recurring.usage_type === 'licensed') && price.currency === expectedPrice.currency && price.billing_scheme === 'per_unit'
      && integer(price.unit_amount) && price.unit_amount > 0 && (expectedPrice.unitAmount === undefined || price.unit_amount === expectedPrice.unitAmount)
      && (!price.unit_amount_decimal || (/^\d+(?:\.\d{1,12})?$/.test(price.unit_amount_decimal) && Number(price.unit_amount_decimal) === price.unit_amount))
      && !price.transform_quantity && !price.tiers_mode && !price.custom_unit_amount
      && (!forSale || (price.active === true && expectedPrice.sellable !== false)), 'stripe_price_shape_unsupported');
    return price;
  }
  function normalizeCheckout(session, expectedId) {
    scoped(session, 'checkout.session', 'cs', expectedId);
    demand(idValid(idOf(session.customer), 'cus') && ['open', 'complete', 'expired'].includes(session.status)
      && ['subscription', 'payment', 'setup'].includes(session.mode), 'stripe_checkout_shape_invalid');
    const subscription = session.subscription == null ? null : requireId(idOf(session.subscription), 'sub');
    return { id: session.id, customer: idOf(session.customer), livemode: session.livemode, client_reference_id: session.client_reference_id,
      status: session.status, mode: session.mode, url: session.url, subscription };
  }
  async function retrieveCheckout(ctx, sessionId) {
    requireId(sessionId, 'cs');
    return normalizeCheckout(await request(ctx, 'GET', `/v1/checkout/sessions/${sessionId}`), sessionId);
  }
  async function invoice(ctx, invoiceId, customerId) {
    requireId(invoiceId, 'in');
    const inv = scoped(await request(ctx, 'GET', `/v1/invoices/${invoiceId}`), 'invoice', 'in', invoiceId);
    demand(idValid(idOf(inv.customer), 'cus') && (!customerId || idOf(inv.customer) === customerId), 'stripe_invoice_scope_invalid');
    return inv;
  }
  function invoiceSubscription(inv) {
    if (inv.parent == null) return null;
    demand(inv.parent.type === 'subscription_details', 'stripe_invoice_parent_unsupported');
    return requireId(idOf(inv.parent.subscription_details?.subscription), 'sub');
  }
  async function charge(ctx, chargeId, customerId) {
    requireId(chargeId, 'ch');
    const c = scoped(await request(ctx, 'GET', `/v1/charges/${chargeId}`), 'charge', 'ch', chargeId);
    demand(idValid(idOf(c.customer), 'cus') && (!customerId || idOf(c.customer) === customerId), 'stripe_charge_scope_invalid');
    return c;
  }

  async function paymentCoverage(ctx, inv, line, sub, price, binding) {
    const payments = await list(ctx, '/v1/invoice_payments', { invoice: inv.id });
    for (const p of payments) {
      scoped(p, 'invoice_payment', 'inpay');
      demand(idOf(p.invoice) === inv.id && ['paid', 'open', 'canceled'].includes(p.status), 'stripe_payment_scope_invalid');
    }
    const paid = payments.filter(p => p.status !== 'canceled');
    demand(paid.length === 1 && paid[0].status === 'paid' && paid[0].is_default === true
      && paid[0].currency === price.currency && paid[0].payment?.type === 'payment_intent'
      && equalMoney(paid[0].amount_paid, paid[0].amount_requested, inv.amount_paid), 'stripe_payment_shape_unsupported');
    const payment = paid[0], paymentIntentId = requireId(idOf(payment.payment.payment_intent), 'pi');
    // A shared PaymentIntent makes invoice-level refund allocation ambiguous.
    const allocations = await list(ctx, '/v1/invoice_payments', { payment: { type: 'payment_intent', payment_intent: paymentIntentId } });
    for (const allocation of allocations) {
      scoped(allocation, 'invoice_payment', 'inpay');
      demand(allocation.payment?.type === 'payment_intent' && idOf(allocation.payment.payment_intent) === paymentIntentId
        && ['paid', 'open', 'canceled'].includes(allocation.status), 'stripe_payment_scope_invalid');
    }
    const currentAllocations = allocations.filter(p => p.status !== 'canceled');
    demand(currentAllocations.length === 1 && currentAllocations[0].id === payment.id
      && idOf(currentAllocations[0].invoice) === inv.id && currentAllocations[0].status === 'paid'
      && currentAllocations[0].amount_paid === payment.amount_paid, 'stripe_shared_payment_unsupported');
    const evidence = await chargeCoverage(ctx, paymentIntentId, inv.amount_paid, price.currency, binding);
    return { invoiceId: inv.id, subscriptionId: sub.id, priceId: price.id, currency: price.currency, invoiceStatus: 'paid',
      successfulCharge: true, amountPaid: inv.amount_paid, ...evidence, start: line.period.start, end: line.period.end };
  }

  async function chargeCoverage(ctx, paymentIntentId, amount, currency, binding, lifetime = false) {
    const intent = scoped(await request(ctx, 'GET', `/v1/payment_intents/${paymentIntentId}`), 'payment_intent', 'pi', paymentIntentId);
    demand(!lifetime || (intent.metadata?.firebaseUid === binding.uid && intent.metadata?.billingSchema === '1' && intent.metadata?.plan === 'lifetime'), 'stripe_lifetime_intent_binding_invalid');
    demand(idOf(intent.customer) === binding.customerId && intent.status === 'succeeded' && intent.currency === currency
      && equalMoney(intent.amount, intent.amount_received, amount) && intent.amount_capturable === 0
      && ['automatic', 'automatic_async'].includes(intent.capture_method) && Array.isArray(intent.payment_method_types)
      && intent.payment_method_types.length === 1 && intent.payment_method_types[0] === 'card'
      && !intent.on_behalf_of && !intent.transfer_data && !intent.application, 'stripe_payment_intent_unsupported');
    const charges = await list(ctx, '/v1/charges', { customer: binding.customerId, payment_intent: paymentIntentId });
    for (const c of charges) {
      scoped(c, 'charge', 'ch');
      demand(idOf(c.customer) === binding.customerId && idOf(c.payment_intent) === paymentIntentId
        && ['succeeded', 'failed', 'pending'].includes(c.status), 'stripe_charge_scope_invalid');
    }
    const successful = charges.filter(c => c.status !== 'failed');
    demand(successful.length === 1 && successful[0].status === 'succeeded', 'stripe_charge_shape_unsupported');
    const c = successful[0];
    demand(c.id === idOf(intent.latest_charge) && c.paid === true && c.captured === true
      && equalMoney(c.amount, c.amount_captured, amount) && c.currency === currency
      && c.payment_method_details?.type === 'card' && typeof c.disputed === 'boolean'
      && integer(c.amount_refunded) && c.amount_refunded <= c.amount_captured
      && !c.on_behalf_of && !c.transfer && !c.transfer_data && !c.application && !c.application_fee,
    'stripe_charge_shape_unsupported');
    const refunds = await list(ctx, '/v1/refunds', { charge: c.id });
    let refunded = 0;
    for (const refund of refunds) {
      // Refund has no livemode attribute in the pinned schema. Its retrieved
      // charge supplies the mode/customer scope, and each relationship is checked.
      demand(refund?.object === 'refund' && idValid(refund.id, 're') && idOf(refund.charge) === c.id
        && (refund.payment_intent == null || idOf(refund.payment_intent) === paymentIntentId)
        && (refund.customer == null || idOf(refund.customer) === binding.customerId)
        && refund.currency === currency && integer(refund.amount) && refund.amount > 0
        && REFUND_STATUSES.has(refund.status), 'stripe_refund_shape_unsupported');
      if (refund.status === 'succeeded') refunded += refund.amount;
    }
    demand(integer(refunded) && refunded <= c.amount_captured, 'stripe_refund_total_invalid');
    // Never turn a truncated/stale refund list into fresh paid access. A changing
    // provider graph is retried by the coordinator after it becomes consistent.
    demand(refunded === c.amount_refunded, 'stripe_refund_evidence_inconsistent');
    const disputes = await list(ctx, '/v1/disputes', { charge: c.id });
    for (const dispute of disputes) {
      scoped(dispute, 'dispute', 'du');
      demand(idOf(dispute.charge) === c.id && (dispute.payment_intent == null || idOf(dispute.payment_intent) === paymentIntentId)
        && dispute.currency === currency && integer(dispute.amount) && dispute.amount > 0
        && DISPUTE_STATUSES.has(dispute.status), 'stripe_dispute_shape_unsupported');
    }
    demand(!c.disputed || disputes.length > 0, 'stripe_dispute_evidence_missing');
    // All non-won dispute states, including warnings, are conservatively blocked.
    const disputeStatus = !disputes.length ? 'none' : disputes.every(d => d.status === 'won') ? 'won'
      : disputes.some(d => d.status === 'lost') ? 'lost' : 'open';
    return {amountRefunded: refunded, disputeStatus};
  }

  async function lifetimeSnapshot(ctx, binding) {
    const expected = prices?.lifetime;
    if (!expected) return null;
    const sessions = await list(ctx, '/v1/checkout/sessions', {customer:binding.customerId, status:'complete'});
    let valid = null;
    for (const entry of sessions) {
      scoped(entry,'checkout.session','cs');
      demand(idOf(entry.customer) === binding.customerId, 'stripe_checkout_scope_invalid');
      if (entry.mode !== 'payment' || entry.metadata?.plan !== 'lifetime' || entry.metadata?.billingSchema !== '1') continue;
      const session = scoped(await request(ctx,'GET',`/v1/checkout/sessions/${entry.id}`),'checkout.session','cs',entry.id);
      demand(session.mode === 'payment' && idOf(session.customer) === binding.customerId && session.client_reference_id === binding.uid
        && session.metadata?.firebaseUid === binding.uid && session.metadata?.billingSchema === '1' && session.metadata?.plan === 'lifetime', 'stripe_checkout_scope_invalid');
      if (session.status !== 'complete' || session.payment_status !== 'paid') continue;
      const price = await validatedPrice(ctx, expected.id);
      const lines = await list(ctx,`/v1/checkout/sessions/${session.id}/line_items`);
      demand(lines.length === 1 && lines[0].object === 'item' && idOf(lines[0].price) === price.id && lines[0].quantity === 1
        && lines[0].currency === price.currency && equalMoney(lines[0].amount_subtotal,lines[0].amount_total,price.unit_amount)
        && lines[0].amount_discount === 0 && lines[0].amount_tax === 0, 'stripe_lifetime_line_invalid');
      demand(session.currency === price.currency && equalMoney(session.amount_subtotal,session.amount_total,price.unit_amount)
        && session.total_details?.amount_discount === 0 && session.total_details?.amount_shipping === 0 && session.total_details?.amount_tax === 0
        && session.automatic_tax?.enabled === false && !session.subscription, 'stripe_lifetime_amount_invalid');
      const paymentIntentId = requireId(idOf(session.payment_intent),'pi');
      const evidence = await chargeCoverage(ctx,paymentIntentId,price.unit_amount,price.currency,binding,true);
      if (evidence.amountRefunded < price.unit_amount && ['none','won'].includes(evidence.disputeStatus)) valid = {
        uid:binding.uid,customerId:binding.customerId,livemode:expectedLivemode,plan:'lifetime',priceId:price.id,
        currency:price.currency,amountPaid:price.unit_amount,successfulCharge:true,...evidence,checkoutSessionId:session.id,paymentIntentId,
      };
    }
    return valid;
  }

  async function currentSnapshot(ctx, binding) {
    await boundCustomer(ctx, binding);
    const lifetime = await lifetimeSnapshot(ctx,binding);
    if (lifetime) return lifetime;
    const all = await subscriptions(ctx, binding.customerId);
    const live = all.filter(s => !TERMINAL.has(s.status));
    demand(live.length <= 1, 'stripe_multiple_memberships');
    const candidates = live.length ? live : all.slice().sort((a, b) => b.created - a.created);
    if (!candidates.length) return { uid: binding.uid, customerId: binding.customerId, livemode: expectedLivemode, subscriptionId: null, status: 'none', paidPeriods: [] };
    demand(live.length || candidates.length < 2 || candidates[0].created !== candidates[1].created, 'stripe_ambiguous_membership');
    const sub = await retrieveSubscription(ctx, candidates[0].id, binding.customerId);
    demand(sub.metadata?.firebaseUid === binding.uid && sub.metadata?.billingSchema === '1', 'stripe_subscription_binding_invalid');
    const items = await embeddedOrList(ctx, sub.items, '/v1/subscription_items', { subscription: sub.id });
    demand(items.length === 1 && items[0].object === 'subscription_item' && idValid(items[0].id, 'si')
      && items[0].subscription === sub.id && items[0].quantity === 1, 'stripe_subscription_shape_unsupported');
    const item = items[0];
    const priceId = requireId(idOf(item.price), 'price'), price = await validatedPrice(ctx, priceId);
    demand(sub.collection_method === 'charge_automatically' && sub.currency === price.currency
      && ['classic', 'flexible'].includes(sub.billing_mode?.type) && sub.automatic_tax?.enabled === false
      && empty(sub.discounts) && empty(item.discounts) && empty(item.tax_rates) && empty(sub.default_tax_rates)
      && !sub.pending_update && !sub.pause_collection && !sub.schedule && empty(sub.billing_schedules)
      && !sub.pending_invoice_item_interval && !sub.billing_thresholds && !item.billing_thresholds
      && !sub.on_behalf_of && !sub.transfer_data && !sub.application && !sub.trial_start && !sub.trial_end
      && integer(item.current_period_start) && integer(item.current_period_end) && item.current_period_end > item.current_period_start
      && typeof sub.cancel_at_period_end === 'boolean' && (sub.cancel_at == null || integer(sub.cancel_at)), 'stripe_subscription_shape_unsupported');
    const snapshot = { uid: binding.uid, customerId: binding.customerId, livemode: expectedLivemode, subscriptionId: sub.id,
      status: sub.status, priceId, itemCount: 1, quantity: 1, currency: price.currency, interval: price.recurring.interval, intervalCount: 1,
      currentPeriodStart: item.current_period_start, currentPeriodEnd: item.current_period_end,
      cancelAt: sub.cancel_at ?? null, cancelAtPeriodEnd: sub.cancel_at_period_end, paidPeriods: [] };
    if (!['active', 'past_due'].includes(sub.status)) return snapshot;
    const invoices = await list(ctx, '/v1/invoices', { customer: binding.customerId, subscription: sub.id });
    const nowSeconds = Math.floor(now() / 1000);
    for (const inv of invoices) {
      scoped(inv, 'invoice', 'in');
      demand(idOf(inv.customer) === binding.customerId && invoiceSubscription(inv) === sub.id && INVOICE_STATUSES.has(inv.status), 'stripe_invoice_scope_invalid');
      if (inv.status !== 'paid') continue;
      const lines = await embeddedOrList(ctx, inv.lines, `/v1/invoices/${inv.id}/lines`, {});
      // Read all service periods before deciding a paid invoice is irrelevant.
      for (const line of lines) demand(line?.object === 'line_item' && idValid(line.id, 'il')
        && line.livemode === expectedLivemode && (line.invoice == null || line.invoice === inv.id)
        && integer(line.period?.start) && integer(line.period?.end) && line.period.end > line.period.start, 'stripe_invoice_line_invalid');
      demand(lines.length > 0, 'stripe_invoice_lines_missing');
      if (!lines.some(line => line.period.start <= nowSeconds && line.period.end > nowSeconds)) continue;
      demand(lines.length === 1, 'stripe_invoice_shape_unsupported');
      const line = lines[0], parent = line.parent?.subscription_item_details;
      demand(line.parent?.type === 'subscription_item_details' && parent?.subscription === sub.id
        && parent.subscription_item === item.id && parent.proration === false && parent.invoice_item == null
        && line.pricing?.type === 'price_details' && idOf(line.pricing.price_details?.price) === price.id
        && line.quantity === 1 && (line.quantity_decimal == null || /^1(?:\.0{1,12})?$/.test(line.quantity_decimal))
        && line.currency === price.currency && equalMoney(line.amount, price.unit_amount)
        && empty(line.discounts) && empty(line.discount_amounts) && empty(line.pretax_credit_amounts) && empty(line.taxes), 'stripe_invoice_line_unsupported');
      demand(['subscription_create', 'subscription_cycle'].includes(inv.billing_reason)
        && inv.collection_method === 'charge_automatically' && inv.currency === price.currency
        && equalMoney(inv.amount_paid, inv.amount_due, inv.total, inv.subtotal, line.amount)
        && inv.amount_remaining === 0 && inv.amount_overpaid === 0 && inv.starting_balance === 0 && inv.ending_balance === 0
        && inv.pre_payment_credit_notes_amount === 0 && inv.post_payment_credit_notes_amount === 0
        && inv.automatic_tax?.enabled === false && empty(inv.discounts) && empty(inv.total_discount_amounts)
        && empty(inv.total_taxes) && empty(inv.total_pretax_credit_amounts)
        && !inv.on_behalf_of && !inv.application && !inv.from_invoice && !inv.latest_revision
        && inv.amount_shipping === 0 && !inv.shipping_cost, 'stripe_invoice_shape_unsupported');
      snapshot.paidPeriods.push(await paymentCoverage(ctx, inv, line, sub, price, binding));
    }
    demand(snapshot.paidPeriods.length <= 1, 'stripe_overlapping_paid_periods');
    return snapshot;
  }

  async function resolveEventCustomer(ctx, event) {
    demand(event && SUPPORTED_EVENTS.has(event.type) && event.livemode === expectedLivemode, 'stripe_event_scope_invalid');
    let customerId, subscriptionId = null;
    if (event.type.startsWith('checkout.session.')) {
      const c = await retrieveCheckout(ctx, event.objectId); customerId = c.customer; subscriptionId = c.subscription;
    } else if (event.type.startsWith('customer.subscription.')) {
      requireId(event.objectId, 'sub');
      const s = scoped(await request(ctx, 'GET', `/v1/subscriptions/${event.objectId}`), 'subscription', 'sub', event.objectId);
      customerId = requireId(idOf(s.customer), 'cus'); subscriptionId = s.id;
    } else if (event.type.startsWith('invoice.')) {
      const inv = await invoice(ctx, event.objectId); customerId = idOf(inv.customer); subscriptionId = invoiceSubscription(inv);
    } else {
      let chargeId = event.objectId, reference;
      if (event.type.startsWith('refund.')) {
        requireId(event.objectId, 're'); reference = await request(ctx, 'GET', `/v1/refunds/${event.objectId}`);
        demand(reference?.object === 'refund' && reference.id === event.objectId, 'stripe_refund_shape_unsupported');
        chargeId = requireId(idOf(reference.charge), 'ch');
      } else if (event.type.startsWith('charge.dispute.')) {
        requireId(event.objectId, 'du');
        reference = scoped(await request(ctx, 'GET', `/v1/disputes/${event.objectId}`), 'dispute', 'du', event.objectId);
        chargeId = requireId(idOf(reference.charge), 'ch');
      }
      const c = await charge(ctx, chargeId); customerId = idOf(c.customer);
      if (reference) demand((reference.customer == null || idOf(reference.customer) === customerId)
        && (reference.payment_intent == null || idOf(reference.payment_intent) === idOf(c.payment_intent)), 'stripe_event_relationship_invalid');
    }
    return { customerId, customer: await customer(ctx, customerId), subscriptionId };
  }

  return Object.freeze({
    apiVersion: STRIPE_API_VERSION,
    retrieveCustomer: operation(customer),
    createCustomer: operation(async (ctx, params, key) => {
      demand(params && typeof params.email === 'string' && uidValid(params.metadata?.firebaseUid)
        && params.metadata.billingSchema === '1' && typeof key === 'string', 'stripe_invalid_parameters');
      const c = scoped(await request(ctx, 'POST', '/v1/customers', params, key), 'customer', 'cus');
      demand(c.metadata?.firebaseUid === params.metadata.firebaseUid && c.metadata?.billingSchema === '1', 'stripe_binding_invalid');
      return { id: c.id, livemode: c.livemode, metadata: { firebaseUid: c.metadata.firebaseUid, billingSchema: c.metadata.billingSchema } };
    }),
    createCheckoutSession: operation(async (ctx, params, key) => {
      demand(['subscription','payment'].includes(params?.mode) && idValid(params.customer, 'cus') && uidValid(params.client_reference_id)
        && params.metadata?.firebaseUid === params.client_reference_id && (params.mode === 'payment' ? params.payment_intent_data?.metadata?.firebaseUid === params.client_reference_id && params.metadata?.plan === 'lifetime' && approved.get(params.line_items?.[0]?.price)?.plan === 'lifetime' : params.subscription_data?.metadata?.firebaseUid === params.client_reference_id && approved.get(params.line_items?.[0]?.price)?.plan !== 'lifetime')
        && params.line_items?.length === 1 && approved.has(params.line_items[0].price) && params.line_items[0].quantity === 1
        && params.payment_method_types?.length === 1 && params.payment_method_types[0] === 'card'
        && typeof key === 'string', 'stripe_invalid_parameters');
      await validatedPrice(ctx, params.line_items[0].price, true);
      const c = normalizeCheckout(await request(ctx, 'POST', '/v1/checkout/sessions', params, key));
      demand(c.mode === params.mode && c.customer === params.customer && c.client_reference_id === params.client_reference_id, 'stripe_checkout_shape_invalid');
      return c;
    }),
    retrieveCheckoutSession: operation(retrieveCheckout),
    createPortalSession: operation(async (ctx, params, key) => {
      demand(idValid(params?.customer, 'cus') && idValid(params.configuration, 'bpc') && typeof params.return_url === 'string', 'stripe_invalid_parameters');
      const portalConfig = scoped(await request(ctx, 'GET', `/v1/billing_portal/configurations/${params.configuration}`), 'billing_portal.configuration', 'bpc', params.configuration);
      demand(portalConfig.active === true && !portalConfig.application
        && portalConfig.features?.subscription_update?.enabled === false
        && portalConfig.features?.subscription_cancel?.enabled === true
        && portalConfig.features.subscription_cancel.mode === 'at_period_end'
        && portalConfig.features.subscription_cancel.proration_behavior === 'none'
        && portalConfig.features?.payment_method_update?.enabled === true, 'stripe_portal_configuration_unsupported');
      const session = await request(ctx, 'POST', '/v1/billing_portal/sessions', params, key);
      demand(session?.object === 'billing_portal.session' && idValid(session.id, 'bps') && idOf(session.customer) === params.customer
        && session.livemode === expectedLivemode && typeof session.url === 'string', 'stripe_portal_shape_invalid');
      return { id: session.id, customer: idOf(session.customer), livemode: session.livemode, url: session.url };
    }),
    listAllSubscriptions: operation(async (ctx, customerId) => (await subscriptions(ctx, customerId)).map(s => ({ id: s.id, customer: idOf(s.customer), livemode: s.livemode, status: s.status, created: s.created }))),
    resolveEventCustomer: operation(resolveEventCustomer),
    currentSubscriptionSnapshot: operation(currentSnapshot),
  });
}
