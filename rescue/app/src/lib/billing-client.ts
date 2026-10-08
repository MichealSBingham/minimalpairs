import { getFreshVerifiedIdToken, getSession } from './auth';

export type MembershipPlan = 'monthly' | 'annual' | 'lifetime';
export type CheckoutStatus = { state: 'none' | 'existing_subscription' | 'lifetime' }
  | { state: 'open' | 'pending'; plan: MembershipPlan; requestId: string; createdAt: number };
const enabled = import.meta.env.PUBLIC_BILLING_ENABLED === 'true';
const checkoutEnabled = import.meta.env.PUBLIC_BILLING_CHECKOUT_ENABLED === 'true';
const configuredOrigin = import.meta.env.PUBLIC_BILLING_API_ORIGIN || '';
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiOrigin(): string | null {
  try {
    const url = new URL(configuredOrigin);
    return url.protocol === 'https:' && url.origin === configuredOrigin && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
export const billingAvailable = enabled && apiOrigin() !== null;
export const checkoutAvailable = billingAvailable && checkoutEnabled;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const unavailable = () => failure('billing/unavailable', 'Membership billing is not available yet. Your existing practice and purchased access are unchanged.');
const messages: Record<string, string> = {
  lifetime_access_already_covers_membership: 'Your lifetime purchase already covers this access. You do not need a subscription.',
  existing_subscription_use_portal: 'A membership is already connected. Manage that membership before starting another.',
  another_checkout_is_open: 'You already have a checkout in progress. Return to that plan before trying a different one.',
  checkout_reconciliation_pending: 'Your previous checkout is still being checked. Do not start another payment; check your account again shortly.',
  checkout_configuration_changed: 'This checkout needs to be reviewed before it can continue. No new checkout was started.',
  customer_reconciliation_pending: 'Your previous billing action is still being checked. Check your account again shortly before starting another payment.',
  verified_account_required: 'Sign in again with your verified email before managing a membership.',
  no_billing_account: 'No membership is connected to this account.',
  workflow_deadline_exceeded: 'The billing service took too long to respond. Check your account before trying again.',
};

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw unavailable();
      const { done, value } = await reader.read();
      if (signal.aborted) throw unavailable();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw unavailable(); }
}

async function request(kind: 'checkout' | 'portal' | 'checkout-status', expectedUserId: string, body: Record<string, unknown>): Promise<unknown> {
  const origin = apiOrigin();
  if (!billingAvailable || !origin || (kind === 'checkout' && !checkoutAvailable)) throw unavailable();
  const token = await getFreshVerifiedIdToken(expectedUserId);
  const before = await getSession();
  if (before?.user.id !== expectedUserId || !before.user.email_verified) throw failure('app/account-changed', 'Your signed-in account changed. Please try again.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${origin}/billing/${kind}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const result = await boundedResponse(response, controller.signal);
    const after = await getSession();
    if (after?.user.id !== expectedUserId || !after.user.email_verified) throw failure('app/account-changed', 'Your signed-in account changed. Return to your account before continuing.');
    if (!response.ok) {
      const code = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : '';
      const known = Object.hasOwn(messages, code);
      throw failure(`billing/${known ? code : 'unavailable'}`, known ? messages[code] : 'We could not confirm the billing action. Check your account before trying again.');
    }
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^(billing|app)\//.test(error.code)) throw error;
    throw failure('billing/unavailable', 'We could not confirm the billing action. Check your account before trying again.');
  } finally { clearTimeout(timer); }
}

function destination(result: unknown, kind: 'checkout' | 'portal'): string {
  try {
    if (!result || typeof result !== 'object' || !('url' in result) || typeof result.url !== 'string' || result.url.length > 4096) throw unavailable();
    const url = new URL(result.url);
    const host = kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) throw unavailable();
    return url.href;
  } catch { throw unavailable(); }
}

/** No request occurs on import or page load. A caller must initiate each action. */
export async function createMembershipCheckout(plan: MembershipPlan, requestId: string, expectedUserId: string): Promise<string> {
  if (!['monthly', 'annual', 'lifetime'].includes(plan) || !requestIdPattern.test(requestId)) return Promise.reject(failure('billing/invalid-request', 'Choose a membership plan and try again.'));
  let analytics: unknown;
  try { analytics = (await import('./measurement')).checkoutAttribution(); } catch { /* Optional analytics must never block checkout. */ }
  return destination(await request('checkout', expectedUserId, { plan, requestId, ...(analytics ? { analytics } : {}) }), 'checkout');
}
export async function createMembershipPortal(expectedUserId: string): Promise<string> {
  return destination(await request('portal', expectedUserId, {}), 'portal');
}
/** Explicit user action only. This endpoint cannot initiate a purchase. */
export async function getMembershipCheckoutStatus(expectedUserId: string): Promise<CheckoutStatus> {
  const result = await request('checkout-status', expectedUserId, {});
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('state' in result) || typeof result.state !== 'string') throw unavailable();
  if (['none', 'existing_subscription', 'lifetime'].includes(result.state)) {
    if (Object.keys(result).some(key => key !== 'state')) throw unavailable();
    return result as CheckoutStatus;
  }
  if (!['open', 'pending'].includes(result.state)
    || Object.keys(result).some(key => !['state', 'plan', 'requestId', 'createdAt'].includes(key))
    || !('plan' in result) || typeof result.plan !== 'string' || !['monthly', 'annual', 'lifetime'].includes(result.plan)
    || !('requestId' in result) || typeof result.requestId !== 'string' || !requestIdPattern.test(result.requestId)
    || !('createdAt' in result) || typeof result.createdAt !== 'number' || !Number.isSafeInteger(result.createdAt)
    || result.createdAt <= 0 || result.createdAt > Math.floor(Date.now() / 1000) + 300) throw unavailable();
  return result as CheckoutStatus;
}
