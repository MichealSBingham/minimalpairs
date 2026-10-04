import type { MembershipPlan, CheckoutStatus } from './billing-client';

export type PendingCheckout = { version: 1; uid: string; plan: MembershipPlan; requestId: string; createdAt: number };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = () => new Error('This browser could not safely remember your checkout. Allow site storage or use another browser before continuing.');
export function checkoutStorageKey(uid: string) {
  if (!uid || uid.length > 128) throw unavailable();
  return `minimalpairs.checkout.v1:${encodeURIComponent(uid)}`;
}
export function readPendingCheckout(store: Store, uid: string): PendingCheckout | null {
  try {
    const raw = store.getItem(checkoutStorageKey(uid));
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.uid !== uid || !['monthly', 'annual'].includes(value.plan) || !uuid.test(value.requestId) || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) throw unavailable();
    return value;
  } catch { throw unavailable(); }
}
/** Caller holds the per-account browser lock. No expiry reset: uncertain requests keep their identity. */
export function reserveCheckout(store: Store, uid: string, plan: MembershipPlan, createId = () => crypto.randomUUID(), now = Date.now()): PendingCheckout {
  const existing = readPendingCheckout(store, uid);
  if (existing) {
    if (existing.plan !== plan) throw new Error('A checkout for the other plan is still in progress. Resume that checkout or check your access first.');
    return existing;
  }
  const value: PendingCheckout = { version: 1, uid, plan, requestId: createId(), createdAt: now };
  if (!uuid.test(value.requestId) || !['monthly', 'annual'].includes(plan) || !Number.isSafeInteger(now) || now <= 0) throw unavailable();
  try {
    store.setItem(checkoutStorageKey(uid), JSON.stringify(value));
    const saved = readPendingCheckout(store, uid);
    if (saved?.requestId !== value.requestId || saved.plan !== plan) throw unavailable();
    return saved;
  } catch { throw unavailable(); }
}
/** Caller has a fresh confirmed grant or a server-confirmed absence of unfinished checkout. */
export function clearConfirmedCheckout(store: Store, uid: string) {
  try { store.removeItem(checkoutStorageKey(uid)); if (store.getItem(checkoutStorageKey(uid)) !== null) throw unavailable(); }
  catch { throw unavailable(); }
}
/** Caller holds the per-account lock and has checked a fresh response's account. */
export function adoptServerCheckout(store: Store, uid: string, status: Extract<CheckoutStatus, { plan: MembershipPlan }>): PendingCheckout {
  const value: PendingCheckout = { version: 1, uid, plan: status.plan, requestId: status.requestId, createdAt: status.createdAt * 1000 };
  if (!['open', 'pending'].includes(status.state) || !['monthly', 'annual'].includes(value.plan)
    || !uuid.test(value.requestId) || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) throw unavailable();
  try {
    store.setItem(checkoutStorageKey(uid), JSON.stringify(value));
    const saved = readPendingCheckout(store, uid);
    if (saved?.requestId !== value.requestId || saved.plan !== value.plan) throw unavailable();
    return saved;
  } catch { throw unavailable(); }
}
export async function withCheckoutLock<T>(locks: LockManager | undefined, uid: string, action: () => Promise<T>): Promise<T> {
  if (!locks) throw new Error('This browser cannot safely coordinate checkout tabs. Use a current browser to continue.');
  return locks.request(checkoutStorageKey(uid), { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Checkout is already being opened in another tab. Return to that tab or check your access shortly.');
    return action();
  });
}
