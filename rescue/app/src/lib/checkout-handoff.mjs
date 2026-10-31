// One-tab, short-lived continuation of an explicitly selected membership plan.
const KEY = 'minimalpairs.checkout-handoff.v1';
export function saveCheckoutHandoff(storage, plan, context = {}, now = Date.now(), nonce = crypto.randomUUID()) {
  if (!['monthly', 'lifetime'].includes(plan)) return null;
  storage.setItem(KEY, JSON.stringify({plan, context, createdAt:now, nonce}));
  return nonce;
}
export function takeCheckoutHandoff(storage, search, now = Date.now()) {
  const query = new URLSearchParams(search), nonce = query.get('checkout_intent');
  if (!nonce) return null;
  const raw = storage.getItem(KEY);
  storage.removeItem(KEY); // consumed before identity or a network request; reload cannot replay it
  try {
    const value = JSON.parse(raw);
    if (query.has('billing') || value.nonce !== nonce || value.plan !== query.get('plan') || !['monthly','lifetime'].includes(value.plan) || !Number.isFinite(value.createdAt) || now < value.createdAt || now-value.createdAt > 15*60*1000) return null;
    return {plan:value.plan, context:value.context && typeof value.context==='object' ? value.context : {}};
  } catch { return null; }
}
