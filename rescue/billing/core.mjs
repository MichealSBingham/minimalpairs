import {marketParameters, validRegionalCoverage, validSupportCoverage} from './markets.mjs';
import {attributionMetadata, attributionFromMetadata} from './analytics.mjs';
/**
 * Isolated billing policy/HTTP core. No credentials, live adapters, default
 * Worker export, automatic emails, price creation or deployment configuration.
 * The production adapters and durable coordinator in README.md are required.
 */
export const BILLING_SCHEMA = 1;
export const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible', 'invoice.finalization_failed',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
]);
const encoder = new TextEncoder();
const objectId = value => typeof value === 'string' && /^[a-z]+_(?:test_|live_)?[A-Za-z0-9]{1,180}$/.test(value);
const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
export class BillingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new BillingError(code, status); };

/** This validates the trusted verifier's result, not the JWT signature itself. */
export function requireVerifiedAccount(account) {
  if (!account || !uidValid(account.uid) || account.emailVerified !== true || account.serverVerified !== true
    || typeof account.email !== 'string' || account.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email.trim())) fail('verified_account_required', 401);
  return { uid: account.uid, email: account.email.trim().toLowerCase() };
}

export function hasLifetimeAccess(grant) { return grant?.active === true && grant?.plan === 'lifetime'; }
function approvedPrice(config, plan) {
  const price = config.prices?.[plan];
  if (!['monthly', 'annual', 'lifetime'].includes(plan) || !price || !/^price_[A-Za-z0-9]+$/.test(price.id)
    || price.currency !== 'usd' || (plan === 'lifetime' ? price.interval !== null || price.intervalCount !== 0 || price.unitAmount !== 2900 : price.interval !== (plan === 'monthly' ? 'month' : 'year') || price.intervalCount !== 1)) fail('price_not_configured', 503);
  return price;
}
function checkoutAllowed(config) {
  if (config.serviceEnabled !== true || config.checkoutEnabled !== true || config.communicationsApproved !== true) fail('checkout_not_enabled', 503);
}
function sameOrigin(config, request) {
  let origin;
  try { origin = new URL(config.appOrigin); } catch { fail('origin_not_configured', 503); }
  if (origin.protocol !== 'https:' || origin.origin !== config.appOrigin || request.headers.get('Origin') !== origin.origin) fail('origin_not_allowed', 403);
}
function bindCustomer(customer, account, livemode, expectedId) {
  if (!customer || !/^cus_[A-Za-z0-9]+$/.test(customer.id) || customer.deleted || customer.livemode !== livemode
    || customer.metadata?.firebaseUid !== account.uid || (expectedId && customer.id !== expectedId)) fail('customer_binding_invalid', 409);
  return customer.id;
}
function safeStripeUrl(value, hostname) {
  try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === hostname && !url.port && !url.username && !url.password) return url.href; } catch { /* Reject untrusted redirect values. */ }
  fail('billing_url_invalid', 502);
}
function bodyKeys(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) fail('invalid_request');
}
/** Durable JSON maps may reorder keys. Arrays still have meaningful ordering. */
export function sameCheckoutParameters(left, right) {
  const canonical = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    throw new TypeError('Unsupported saved checkout value');
  };
  try { return canonical(left) === canonical(right); } catch { return false; }
}
async function boundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length') || 0) > limit) fail('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); fail('request_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Known prices and Firebase UID come from the server, never Checkout form data. */
export function checkoutParameters(config, account, customerId, plan, analytics) {
  checkoutAllowed(config);
  const price = approvedPrice(config, plan);
  if (price.sellable === false) fail('plan_not_available', 409);
  return {
    mode: plan === 'lifetime' ? 'payment' : 'subscription', customer: customerId, client_reference_id: account.uid,
    line_items: [{ price: price.id, quantity: 1 }], payment_method_types: ['card'],
    ...(plan === 'lifetime' ? { payment_intent_data: { metadata: { firebaseUid: account.uid, billingSchema: String(BILLING_SCHEMA), plan: 'lifetime' } } } : { subscription_data: { metadata: { firebaseUid: account.uid, billingSchema: String(BILLING_SCHEMA) } } }),
    metadata: { firebaseUid: account.uid, billingSchema: String(BILLING_SCHEMA), plan, ...attributionMetadata(analytics) },
    success_url: `${config.appOrigin}/account?billing=return`, cancel_url: `${config.appOrigin}/pricing?billing=cancel`,
    allow_promotion_codes: false,
  };
}

/** Verify exact raw bytes before JSON parsing; support secret rotation and v1 only. */
export async function verifyStripeEvent(rawBody, signatureHeader, secrets, { now = Date.now(), expectedLivemode, maxBytes = 1_048_576 } = {}) {
  const bytes = rawBody instanceof Uint8Array ? rawBody : new Uint8Array(rawBody);
  if (bytes.byteLength > maxBytes) fail('webhook_too_large', 413);
  if (!Array.isArray(secrets) || !secrets.length || secrets.length > 2 || secrets.some(secret => typeof secret !== 'string' || !secret.startsWith('whsec_'))) fail('webhook_not_configured', 503);
  if (typeof signatureHeader !== 'string' || signatureHeader.length > 4096 || !Number.isFinite(now)) fail('invalid_signature', 400);
  const parts = signatureHeader.split(',').map(item => item.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't').map(([, value]) => value);
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '')).map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0] || '') || !signatures.length || signatures.length > 8) fail('invalid_signature', 400);
  const time = Number(timestamps[0]);
  if (!Number.isSafeInteger(time) || Math.abs(now / 1000 - time) > 300) fail('stale_signature', 400);
  const prefix = encoder.encode(`${timestamps[0]}.`);
  const signed = new Uint8Array(prefix.length + bytes.length); signed.set(prefix); signed.set(bytes, prefix.length);
  let verified = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const signature of signatures) {
      const signatureBytes = Uint8Array.from(signature.match(/.{2}/g), value => parseInt(value, 16));
      if (await crypto.subtle.verify('HMAC', key, signatureBytes, signed)) verified = true;
    }
  }
  if (!verified) fail('invalid_signature', 400);
  let event;
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_event', 400); }
  if (!event || !/^evt_[A-Za-z0-9]+$/.test(event.id) || typeof event.type !== 'string' || !whole(event.created)
    || typeof event.livemode !== 'boolean' || event.livemode !== expectedLivemode || event.account || !objectId(event.data?.object?.id)) fail('wrong_event_scope', 400);
  // Queue no charge/customer payload or email. The processor retrieves current
  // canonical Stripe state using this identifier and a pinned API version.
  return { schemaVersion: BILLING_SCHEMA, eventId: event.id, type: event.type, objectId: event.data.object.id, livemode: event.livemode, created: event.created, receivedAt: Math.floor(now / 1000) };
}

/**
 * Trusted normalized snapshot only: adapters must fetch current subscription,
 * recurring item, paid invoices, successful charges, refunds and disputes.
 * Never pass the arriving event's old subscription snapshot straight through.
 */
export function subscriptionEntitlement(snapshot, binding, config, nowSeconds) {
  const base = { schemaVersion: BILLING_SCHEMA, active: false, plan: null, currentPeriodEnd: 0, status: 'unavailable', reason: 'unverified_snapshot', updatedAt: nowSeconds };
  if (!whole(nowSeconds) || !snapshot || !binding || !uidValid(binding.uid) || !/^cus_[A-Za-z0-9]+$/.test(binding.customerId)
    || snapshot.uid !== binding.uid || snapshot.customerId !== binding.customerId || snapshot.livemode !== config.expectedLivemode
    ) return base;
  if (snapshot.plan === 'lifetime') {
    const price = config.prices?.lifetime;
    if (!price || snapshot.priceId !== price.id || snapshot.currency !== 'usd' || !(snapshot.amountPaid === 2900 || validRegionalCoverage(snapshot,config) || validSupportCoverage(snapshot,config) || (snapshot.amountPaid === 1450 && config.recoveryCouponId && snapshot.recoveryCouponId === config.recoveryCouponId)) || price.unitAmount !== 2900
      || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(snapshot.checkoutSessionId || '') || !/^pi_[A-Za-z0-9]+$/.test(snapshot.paymentIntentId || '')
      || snapshot.successfulCharge !== true || !whole(snapshot.amountRefunded) || snapshot.amountRefunded >= snapshot.amountPaid
      || !['none','won'].includes(snapshot.disputeStatus) || snapshot.adminBlocked === true) return {...base, reason:'no_paid_lifetime_coverage'};
    return {...base, active:true, plan:'lifetime', currentPeriodEnd:0, status:'active', reason:'paid_lifetime', customerId:binding.customerId, checkoutSessionId:snapshot.checkoutSessionId, paymentIntentId:snapshot.paymentIntentId};
  }
  if (!/^sub_[A-Za-z0-9]+$/.test(snapshot.subscriptionId)) return base;
  const plan = ['monthly', 'annual'].find(name => config.prices?.[name]?.id === snapshot.priceId);
  if (!plan) return { ...base, reason: 'unapproved_price' };
  const price = approvedPrice(config, plan);
  const result = { ...base, plan, customerId: binding.customerId, subscriptionId: snapshot.subscriptionId, status: snapshot.status };
  if (snapshot.adminBlocked === true) return { ...result, reason: 'admin_blocked' };
  if (snapshot.itemCount !== 1 || snapshot.quantity !== 1 || snapshot.currency !== price.currency
    || snapshot.interval !== price.interval || snapshot.intervalCount !== price.intervalCount
    || !whole(snapshot.currentPeriodStart) || !whole(snapshot.currentPeriodEnd) || snapshot.currentPeriodEnd <= snapshot.currentPeriodStart || snapshot.currentPeriodStart > nowSeconds) return { ...result, reason: 'unsupported_subscription_shape' };
  // No free trial or unpaid grace period is sold by this initial policy. A
  // scheduled end-of-period cancellation still has status active until it ends.
  if (!['active', 'past_due'].includes(snapshot.status)) return { ...result, reason: 'subscription_not_active' };
  const coverage = (Array.isArray(snapshot.paidPeriods) ? snapshot.paidPeriods : []).filter(period =>
    objectId(period.invoiceId) && period.subscriptionId === snapshot.subscriptionId && period.priceId === snapshot.priceId
    && period.currency === price.currency && period.invoiceStatus === 'paid' && period.successfulCharge === true
    && whole(period.amountPaid) && period.amountPaid > 0 && whole(period.amountRefunded) && period.amountRefunded < period.amountPaid
    && ['none', 'won'].includes(period.disputeStatus) && whole(period.start) && whole(period.end)
    && period.start <= nowSeconds && period.end > nowSeconds && period.end > period.start);
  if (!coverage.length) return { ...result, reason: 'no_current_paid_coverage' };
  let end = Math.min(snapshot.currentPeriodEnd, Math.max(...coverage.map(period => period.end)));
  if (snapshot.cancelAt !== null && snapshot.cancelAt !== undefined) {
    if (!whole(snapshot.cancelAt)) return { ...result, reason: 'invalid_cancellation_time' };
    end = Math.min(end, snapshot.cancelAt);
  }
  return { ...result, active: end > nowSeconds, currentPeriodEnd: end, reason: end > nowSeconds ? 'paid_period' : 'paid_period_ended' };
}

/**
 * Ports are mandatory trusted server adapters. billing.runExclusive must be
 * durable serialization (not an in-memory lock), and enqueue must commit the
 * event + alarm/outbox before resolving. No adapters are provided in this stage.
 */
export function createBillingHandler(config, ports) {
  const response = (status, data, origin) => new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(origin === config.appOrigin ? { 'Access-Control-Allow-Origin': config.appOrigin, 'Vary': 'Origin' } : {}),
  } });
  return async request => {
    const origin = request.headers.get('Origin');
    try {
      const path = new URL(request.url).pathname;
      if (!['/billing/checkout', '/billing/checkout-status', '/billing/recovery-offer', '/billing/portal', '/billing/webhook'].includes(path)) fail('not_found', 404);
      if (request.method === 'OPTIONS' && path !== '/billing/webhook') {
        sameOrigin(config, request);
        return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' } });
      }
      if (request.method !== 'POST') fail('method_not_allowed', 405);
      if (config.serviceEnabled !== true) fail('billing_not_enabled', 503);
      if (path === '/billing/webhook') {
        const event = await verifyStripeEvent(await boundedBody(request, 1_048_576), request.headers.get('Stripe-Signature'), config.webhookSecrets, { expectedLivemode: config.expectedLivemode });
        if (!SUPPORTED_EVENTS.has(event.type)) return response(200, { received: true, ignored: true });
        await ports.billing.enqueue(event); // Durable unique event ID + alarm, or throw.
        return response(200, { received: true });
      }
      sameOrigin(config, request);
      if (path === '/billing/checkout') checkoutAllowed(config);
      if (config.communicationsApproved !== true) fail('billing_communications_not_approved', 503);
      const authorization = request.headers.get('Authorization') || '';
      if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) fail('verified_account_required', 401);
      let account;
      try { account = requireVerifiedAccount(await ports.auth.verifyIdToken(authorization.slice(7))); } catch { fail('verified_account_required', 401); }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(request, 2048));
      let body; try { body = JSON.parse(raw || '{}'); } catch { fail('invalid_request'); }
      bodyKeys(body, path === '/billing/checkout' ? ['plan', 'requestId', 'analytics', 'recovery'] : []);
      return await ports.billing.runExclusive(account.uid, async () => {
        let customerId = await ports.billing.customerForUid(account.uid);
        if (path === '/billing/recovery-offer') {
          if (!config.recoveryCouponId || !customerId || hasLifetimeAccess(await ports.legacyEntitlement(account.email))) return response(200, {eligible:false}, origin);
          bindCustomer(await ports.stripe.retrieveCustomer(customerId), account, config.expectedLivemode, customerId);
          const current = await ports.stripe.currentSubscriptionSnapshot({uid:account.uid,customerId});
          if (subscriptionEntitlement(current,{uid:account.uid,customerId},config,Math.floor(Date.now()/1000)).active) return response(200,{eligible:false},origin);
          const subscriptions = await ports.stripe.listAllSubscriptions(customerId);
          if (!Array.isArray(subscriptions) || subscriptions.some(s => !['canceled','incomplete_expired'].includes(s.status))) return response(200,{eligible:false},origin);
          const offer = await ports.billing.recoveryOffer(account.uid);
          const pending = await ports.billing.pendingCheckout(account.uid);
          if (!offer || offer.expiresAt <= Math.floor(Date.now()/1000)+1800 || !pending?.sessionId) return response(200,{eligible:false},origin);
          const session = await ports.stripe.retrieveCheckoutSession(pending.sessionId);
          if(session.customer !== customerId || session.client_reference_id !== account.uid || session.livemode !== config.expectedLivemode) fail('checkout_binding_invalid',502);
          return response(200, session.status === 'complete' ? {eligible:false} : {eligible:true,expiresAt:offer.expiresAt,amount:1450,originalAmount:2900},origin);
        }
        if (path === '/billing/checkout-status') {
          // Only canonical server state can release a browser's uncertain
          // checkout note. This path never creates/expires a Stripe session,
          // sends a message, or grants access from Checkout status alone.
          if (hasLifetimeAccess(await ports.legacyEntitlement(account.email))) return response(200, { state: 'lifetime' }, origin);
          if (!customerId) {
            if (await ports.billing.pendingCheckout(account.uid)) fail('checkout_reconciliation_pending', 409);
            return response(200, { state: 'none' }, origin);
          }
          bindCustomer(await ports.stripe.retrieveCustomer(customerId), account, config.expectedLivemode, customerId);
          if (config.prices?.lifetime) {
            const current = await ports.stripe.currentSubscriptionSnapshot({uid:account.uid,customerId});
            if (subscriptionEntitlement(current,{uid:account.uid,customerId},config,Math.floor(Date.now()/1000)).plan === 'lifetime') return response(200,{state:'lifetime'},origin);
          }
          const subscriptions = await ports.stripe.listAllSubscriptions(customerId);
          if (!Array.isArray(subscriptions)) fail('subscription_state_unavailable', 502);
          if (subscriptions.some(subscription => !['canceled', 'incomplete_expired'].includes(subscription.status))) {
            return response(200, { state: 'existing_subscription' }, origin);
          }
          const pending = await ports.billing.pendingCheckout(account.uid);
          if (!pending) return response(200, { state: 'none' }, origin);
          if (!uuid(pending.requestId) || !['monthly', 'annual', 'lifetime'].includes(pending.plan) || !whole(pending.createdAt)
            || pending.createdAt <= 0 || pending.createdAt > Date.now() / 1000) fail('checkout_reconciliation_pending', 409);
          const detail = { plan: pending.plan, requestId: pending.requestId, createdAt: pending.createdAt };
          if (!pending.sessionId) return response(200, { state: 'pending', ...detail }, origin);
          const session = await ports.stripe.retrieveCheckoutSession(pending.sessionId);
          if (session.id !== pending.sessionId || session.customer !== customerId || session.client_reference_id !== account.uid
            || session.livemode !== config.expectedLivemode || session.mode !== (pending.plan === 'lifetime' ? 'payment' : 'subscription')) fail('checkout_binding_invalid', 502);
          if (session.status === 'expired') {
            await ports.billing.retirePendingCheckout(account.uid, pending.sessionId);
            // A failed or mismatched retirement is not permission to clear a
            // browser note. Re-read under the same durable lock before success.
            if (await ports.billing.pendingCheckout(account.uid)) fail('checkout_reconciliation_pending', 409);
            return response(200, { state: 'none' }, origin);
          }
          if (!['open', 'complete'].includes(session.status)) fail('checkout_binding_invalid', 502);
          return response(200, { state: session.status === 'open' ? 'open' : 'pending', ...detail }, origin);
        }
        if (path === '/billing/portal') {
          if (!customerId) fail('no_billing_account', 404);
          bindCustomer(await ports.stripe.retrieveCustomer(customerId), account, config.expectedLivemode, customerId);
          if (!/^bpc_[A-Za-z0-9]+$/.test(config.portalConfigurationId || '')) fail('portal_not_configured', 503);
          const portal = await ports.stripe.createPortalSession({ customer: customerId, configuration: config.portalConfigurationId, return_url: `${config.appOrigin}/account` });
          return response(200, { url: safeStripeUrl(portal.url, 'billing.stripe.com') }, origin);
        }
        if (body.recovery !== undefined && body.recovery !== true) fail('invalid_request');
        if (body.recovery && body.plan !== 'lifetime') fail('invalid_request');
        if (!uuid(body.requestId)) fail('request_id_required');
        if (approvedPrice(config, body.plan).sellable === false) fail('plan_not_available', 409);
        if (hasLifetimeAccess(await ports.legacyEntitlement(account.email))) fail('lifetime_access_already_covers_membership', 409);
        if (!customerId) {
          const reservation = await ports.billing.reserveCustomer(account.uid, { requestId: crypto.randomUUID(), createdAt: Math.floor(Date.now() / 1000), email: account.email });
          if (!uuid(reservation?.requestId) || !whole(reservation?.createdAt) || Date.now() / 1000 - reservation.createdAt > 23 * 60 * 60 || reservation.createdAt > Date.now() / 1000) fail('customer_reconciliation_pending', 409);
          // Preserve original creation parameters across token/email refreshes.
          // Reservation email is private server ledger data, never a grant key.
          if (typeof reservation.email !== 'string') fail('customer_reconciliation_pending', 409);
          const customer = await ports.stripe.createCustomer({ email: reservation.email, metadata: { firebaseUid: account.uid, billingSchema: String(BILLING_SCHEMA) } }, `customer-v1:${reservation.requestId}`);
          customerId = bindCustomer(customer, account, config.expectedLivemode);
          await ports.billing.bindCustomer(account.uid, customerId);
        } else bindCustomer(await ports.stripe.retrieveCustomer(customerId), account, config.expectedLivemode, customerId);
        if (config.prices?.lifetime) {
          const current = await ports.stripe.currentSubscriptionSnapshot({uid:account.uid,customerId});
          if (subscriptionEntitlement(current,{uid:account.uid,customerId},config,Math.floor(Date.now()/1000)).plan === 'lifetime') fail('lifetime_access_already_covers_membership',409);
        }
        const subscriptions = await ports.stripe.listAllSubscriptions(customerId);
        if (!Array.isArray(subscriptions) || subscriptions.some(subscription => !['canceled', 'incomplete_expired'].includes(subscription.status))) fail('existing_subscription_use_portal', 409);
        let pending = await ports.billing.pendingCheckout(account.uid);
        let recoveryOffer = null;
        if (body.recovery || pending?.parameters?.metadata?.recoveryOffer === 'lifetime50v1') {
          recoveryOffer = await ports.billing.recoveryOffer(account.uid);
          if (!config.recoveryCouponId || !recoveryOffer || recoveryOffer.expiresAt <= Math.floor(Date.now()/1000)+1800) fail('recovery_offer_expired',409);
          if (!pending?.sessionId && !pending?.parameters?.metadata?.recoveryOffer) fail('recovery_offer_unavailable',409);
          if (pending?.sessionId && pending.parameters?.metadata?.recoveryOffer !== 'lifetime50v1') {
            const original = await ports.stripe.retrieveCheckoutSession(pending.sessionId);
            if(original.customer !== customerId || original.client_reference_id !== account.uid || original.livemode !== config.expectedLivemode) fail('checkout_binding_invalid',502);
            if(original.status === 'complete') fail('checkout_reconciliation_pending',409);
            if(original.status === 'open') {
              const expired = await ports.stripe.expireCheckoutSession(pending.sessionId);
              if(expired.status !== 'expired' || expired.customer !== customerId || expired.client_reference_id !== account.uid) fail('checkout_reconciliation_pending',409);
            }
            // Keep the durable reservation until its discounted replacement is saved.
            pending = {...pending, sessionId:undefined, requestId:body.requestId, operationId:crypto.randomUUID(),createdAt:Math.floor(Date.now()/1000)};
            pending.parameters = recoveryParameters(checkoutParameters(config,account,customerId,'lifetime',attributionFromMetadata(pending.parameters?.metadata)),config,recoveryOffer);
            await ports.billing.savePendingCheckout(account.uid,pending);
          }
        }
        // Attribution is a reservation snapshot. A retry keeps the original data
        // (including no data), even after consent, campaign or locale changes.
        let parameters = checkoutParameters(config, account, customerId, body.plan, pending ? attributionFromMetadata(pending.parameters?.metadata) : body.analytics);
        if (!recoveryOffer && !pending) parameters = marketParameters(parameters,config,request.headers.get('X-Internal-Market-Country'));
        if (!recoveryOffer && pending?.parameters?.metadata?.market_version) {
          const m=pending.parameters.metadata; parameters={...parameters,metadata:{...parameters.metadata,...Object.fromEntries(Object.entries(m).filter(([k])=>k.startsWith('market_')))},...(pending.parameters.discounts?{discounts:pending.parameters.discounts}:{})};
        }
        if (recoveryOffer) parameters = pending?.parameters?.metadata?.recoveryOffer === 'lifetime50v1' ? pending.parameters : recoveryParameters(parameters,config,recoveryOffer);
        if(pending?.parameters?.cancel_url === `${config.appOrigin}/pricing` && !recoveryOffer) parameters.cancel_url = pending.parameters.cancel_url;
        // Reservations made before monthly plan metadata was introduced retain
        // their exact Stripe idempotency payload until they expire.
        if(pending && body.plan !== 'lifetime' && pending.parameters?.metadata?.plan === undefined) delete parameters.metadata.plan;
        if (pending?.sessionId) {
          const existing = await ports.stripe.retrieveCheckoutSession(pending.sessionId);
          if (existing.customer !== customerId || existing.client_reference_id !== account.uid || existing.livemode !== config.expectedLivemode) fail('checkout_binding_invalid', 502);
          if (existing.status === 'open') {
            if (pending.plan !== body.plan) fail('another_checkout_is_open', 409);
            if (!sameCheckoutParameters(pending.parameters, parameters)) fail('checkout_configuration_changed', 409);
            return response(200, { url: safeStripeUrl(existing.url, 'checkout.stripe.com') }, origin);
          }
          if (existing.status !== 'expired') fail('checkout_reconciliation_pending', 409);
          pending = null;
          parameters = marketParameters(checkoutParameters(config, account, customerId, body.plan, body.analytics),config,request.headers.get('X-Internal-Market-Country'));
          if (recoveryOffer) parameters = recoveryParameters(parameters,config,recoveryOffer);
        }
        if (pending && pending.plan !== body.plan) fail('another_checkout_is_open', 409);
        if (pending && !sameCheckoutParameters(pending.parameters, parameters)) fail('checkout_configuration_changed', 409);
        if (!pending) {
          pending = { plan: body.plan, requestId: body.requestId, operationId: crypto.randomUUID(), createdAt: Math.floor(Date.now() / 1000), parameters };
          // Reserve before the external request. A crash after Stripe creates
          // a session must retry this same request key, even after page reload.
          await ports.billing.savePendingCheckout(account.uid, pending);
        }
        if (!uuid(pending.requestId) || !uuid(pending.operationId) || !whole(pending.createdAt) || Date.now() / 1000 - pending.createdAt > 23 * 60 * 60 || pending.createdAt > Date.now() / 1000) fail('checkout_reconciliation_pending', 409);
        const checkout = await ports.stripe.createCheckoutSession(pending.parameters, `checkout-v1:${body.plan}:${pending.operationId}`);
        if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(checkout.id || '') || checkout.livemode !== config.expectedLivemode || checkout.customer !== customerId || checkout.client_reference_id !== account.uid || checkout.status !== 'open') fail('checkout_binding_invalid', 502);
        const url = safeStripeUrl(checkout.url, 'checkout.stripe.com');
        await ports.billing.savePendingCheckout(account.uid, { ...pending, sessionId: checkout.id });
        if (config.recoveryCouponId && body.plan === 'lifetime' && !recoveryOffer && !['middle','value'].includes(pending.parameters?.metadata?.market_tier)) await ports.billing.reserveRecoveryOffer(account.uid,{createdAt:pending.createdAt,expiresAt:pending.createdAt+48*60*60,sourceSessionId:checkout.id});
        return response(200, { url }, origin);
      });
    } catch (error) {
      // Never return Stripe errors, ID tokens, customer records or email values.
      return response(error instanceof BillingError ? error.status : 503, { error: error instanceof BillingError ? error.code : 'billing_temporarily_unavailable' }, origin);
    }
  };
}

/**
 * Shared canonical projection; callers hold the durable billing lock and have
 * resolved the server-owned binding. No event payload decides access here.
 */
async function projectCanonicalCustomer(binding, config, ports, nowSeconds) {
  const snapshot = await ports.stripe.currentSubscriptionSnapshot(binding);
  if (!snapshot || snapshot.uid !== binding.uid || snapshot.customerId !== binding.customerId || snapshot.livemode !== config.expectedLivemode) fail('snapshot_binding_invalid', 503);
  const entitlement = subscriptionEntitlement(snapshot, binding, config, nowSeconds);
  // Inconclusive provider evidence is a retry, never proof that paid access ended.
  if (entitlement.reason === 'unverified_snapshot') fail('snapshot_unverified', 503);
  // The writer preserves administrative blocks and never writes legacy grants.
  await ports.entitlements.projectSubscription(binding.uid, entitlement);
  const pending = await ports.billing.pendingCheckout(binding.uid);
  if (pending?.sessionId) {
    const checkout = await ports.stripe.retrieveCheckoutSession(pending.sessionId);
    if (checkout.customer !== binding.customerId || checkout.client_reference_id !== binding.uid || checkout.livemode !== config.expectedLivemode) fail('checkout_binding_invalid', 502);
    if (checkout.status === 'complete' && (entitlement.plan === 'lifetime' ? entitlement.active && checkout.id === snapshot.checkoutSessionId : checkout.subscription === snapshot.subscriptionId)) {
      await ports.billing.retirePendingCheckout(binding.uid, pending.sessionId);
    }
  }
  return { active: entitlement.active, reason: entitlement.reason };
}

/** Periodic recovery uses an existing durable binding, never event fabrication
 * or customer metadata alone. The provider revalidates the customer and current
 * payment graph; this shares the event projection/retirement path exactly. */
export async function reconcileBoundCustomer(accountUid, config, ports, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (config.serviceEnabled !== true) fail('billing_not_enabled', 503);
  if (!uidValid(accountUid) || !whole(nowSeconds)) fail('account_binding_invalid');
  return ports.billing.runProcessingExclusive(async () => {
    const customerId = await ports.billing.customerForUid(accountUid);
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId || '')) fail('customer_binding_unresolved', 503);
    return projectCanonicalCustomer({ uid: accountUid, customerId }, config, ports, nowSeconds);
  });
}

/** One queued event under the durable lock. Unresolved bindings and incomplete
 * canonical fetches remain pending; stale event snapshots never decide access. */
export async function processQueuedEvent(eventId, config, ports, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (config.serviceEnabled !== true) fail('billing_not_enabled', 503);
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId) || !whole(nowSeconds)) fail('invalid_event');
  return ports.billing.runProcessingExclusive(async () => {
    const record = await ports.billing.queuedEvent(eventId);
    if (!record) fail('event_not_queued', 409);
    if (record.processed === true) return { duplicate: true };
    const event = record.event;
    if (event?.eventId !== eventId || event.schemaVersion !== BILLING_SCHEMA || event.livemode !== config.expectedLivemode || !SUPPORTED_EVENTS.has(event.type)) fail('wrong_event_scope');
    const binding = await ports.billing.resolveEventBinding(event);
    // Only a proven unrelated historical/one-off object may be marked ignored.
    // A lookup error or unknown customer is not this affirmative classification.
    if (binding?.unrelated === true) {
      await ports.billing.markProcessed(eventId, { processedAt: nowSeconds, ignored: true });
      return { ignored: true };
    }
    if (!uidValid(binding?.uid) || !/^cus_[A-Za-z0-9]+$/.test(binding?.customerId)) fail('event_binding_unresolved', 503);
    const result = await projectCanonicalCustomer(binding, config, ports, nowSeconds);
    // Mark complete only after projection. A crash here reprojects fresh state.
    await ports.billing.markProcessed(eventId, { processedAt: nowSeconds });
    return result;
  });
}

/** Server-owned coupon and fixed eligibility window; no browser-supplied price. */
export function recoveryParameters(parameters,config,offer,now=Math.floor(Date.now()/1000)) {
  if (!config.recoveryCouponId || parameters.mode !== 'payment' || offer.expiresAt <= now+1800) fail('recovery_offer_expired',409);
  const result = {...parameters, discounts:[{coupon:config.recoveryCouponId}], expires_at:Math.min(now+23*3600,offer.expiresAt),metadata:{...parameters.metadata,recoveryOffer:'lifetime50v1'}};
  delete result.allow_promotion_codes;
  return result;
}
