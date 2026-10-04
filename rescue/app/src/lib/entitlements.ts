import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { getDatabase, getSession } from './auth';

export type Entitlement = { active: boolean; plan: 'lifetime' | 'monthly' | 'annual'; source: 'legacy-purchase' | 'subscription' };
export async function getEntitlement(options: { expectedUserId?: string; fresh?: boolean } = {}): Promise<Entitlement | null> {
  const db = getDatabase();
  const session = await getSession();
  const changed = () => Object.assign(new Error('Your signed-in account changed. Check your account again.'), { code: 'app/account-changed' });
  if (options.expectedUserId && (!session?.user.email_verified || session.user.id !== options.expectedUserId)) throw changed();
  if (!db || !session?.user.email || !session.user.email_verified) {
    if (options.fresh) throw new Error('Purchased access could not be checked with the server.');
    return null;
  }
  const email = session.user.email.trim().toLowerCase();
  async function read(collection: string, id: string) {
    const value = await (options.fresh ? getDocFromServer : getDoc)(doc(db!, collection, id));
    const current = await getSession();
    if (current?.user.id !== session!.user.id || !current.user.email_verified || current.user.email?.trim().toLowerCase() !== email) throw changed();
    return value;
  }
  const lifetime = await read('legacyEntitlements', email);
  if (lifetime.exists() && lifetime.data().active === true && lifetime.data().plan === 'lifetime') {
    return { active: true, plan: 'lifetime', source: 'legacy-purchase' };
  }
  const subscription = await read('entitlements', session.user.id);
  if (!subscription.exists()) return null;
  const data = subscription.data();
  const active = data.active === true && typeof data.currentPeriodEnd === 'number' && data.currentPeriodEnd > Date.now() / 1000;
  return active && (data.plan === 'monthly' || data.plan === 'annual') ? { active, plan: data.plan, source: 'subscription' } : null;
}
