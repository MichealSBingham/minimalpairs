import { useEffect, useRef, useState } from 'react';
import { getSession, observeSession, refreshSession, type SessionUser } from '../lib/auth';
import { billingAvailable, checkoutAvailable, createMembershipCheckout, createMembershipPortal, getMembershipCheckoutStatus, type MembershipPlan, type CheckoutStatus } from '../lib/billing-client';
import { getEntitlement, type Entitlement } from '../lib/entitlements';
import { checkoutStorageKey, clearConfirmedCheckout, readPendingCheckout, reserveCheckout, adoptServerCheckout, withCheckoutLock, type PendingCheckout } from '../lib/billing-checkout-state';
import '../styles/membership.css';

type AccessState = 'loading' | 'ready' | 'error';
const issueMessage = (issue: unknown) => issue instanceof Error ? issue.message : 'We could not confirm that action. Check your access before trying again.';
const issueCode = (issue: unknown) => issue && typeof issue === 'object' && 'code' in issue ? issue.code : '';

/** No checkout or portal request occurs on mount, identity change, focus or return. */
export default function MembershipPanel({ storefront = false, embedded = false }: { storefront?: boolean; embedded?: boolean }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [access, setAccess] = useState<Entitlement | null>(null);
  const [status, setStatus] = useState<AccessState>('loading');
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'status' | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(null);
  const [returning, setReturning] = useState(false);
  const [portalSuggested, setPortalSuggested] = useState(false);
  const generation = useRef(0);
  const requestBusy = useRef(false);
  const currentUid = useRef<string | null>(null);

  function readPending(uid: string) {
    try { setPending(readPendingCheckout(window.localStorage, uid)); setStorageError(''); }
    catch (issue) { setPending(null); setStorageError(issueMessage(issue)); }
  }
  async function checkAccess(expectedUser: SessionUser, token: number, reloadIdentity = false) {
    setStatus('loading'); setError('');
    try {
      if (reloadIdentity) {
        const refreshed = await refreshSession();
        if (refreshed?.user.id !== expectedUser.id || !refreshed.user.email_verified) throw new Error('Your signed-in account changed. Sign in with the account used for checkout.');
      }
      const value = await getEntitlement({ expectedUserId: expectedUser.id, fresh: true });
      if (generation.current !== token || currentUid.current !== expectedUser.id) return;
      setAccess(value); setStatus('ready');
      if (value) {
        setPortalSuggested(false); setCheckoutStatus(null);
        try { clearConfirmedCheckout(window.localStorage, expectedUser.id); setPending(null); setStorageError(''); }
        catch { setStorageError('Your access is confirmed, but this browser could not clear its earlier checkout note.'); }
      }
    } catch (issue) {
      if (generation.current === token) { setAccess(null); setStatus('error'); setError(issueMessage(issue)); }
    }
  }
  useEffect(() => {
    if (!billingAvailable) return;
    const marker = new URLSearchParams(window.location.search).get('billing');
    setReturning(['return', 'cancel', 'canceled'].includes(marker || ''));
    const unsubscribe = observeSession(session => {
      const token = ++generation.current;
      const next = session?.user || null;
      currentUid.current = next?.id || null;
      setUser(next); setIdentityReady(true); setAccess(null); setPending(null); setError(''); setStorageError(''); setPortalSuggested(false); setCheckoutStatus(null);
      if (!next?.email_verified) { setStatus('ready'); return; }
      readPending(next.id);
      void checkAccess(next, token);
    });
    return () => { generation.current += 1; currentUid.current = null; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!billingAvailable || !user?.email_verified) return;
    const uid = user.id;
    const onStorage = (event: StorageEvent) => { if (event.key === checkoutStorageKey(uid) || event.key === null) readPending(uid); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id, user?.email_verified]);

  async function act(kind: 'checkout' | 'portal' | 'status', plan?: MembershipPlan) {
    if (!billingAvailable || !user?.email_verified || requestBusy.current || status !== 'ready') return;
    if (kind === 'checkout' && (!checkoutAvailable || access || storageError || !plan)) return;
    const expectedId = user.id;
    const token = generation.current;
    requestBusy.current = true; setBusy(kind); setError(''); setCheckoutStatus(null);
    const sameAccount = async () => {
      const session = await getSession();
      if (generation.current !== token || currentUid.current !== expectedId || session?.user.id !== expectedId || !session.user.email_verified) throw new Error('Your signed-in account changed. Return to your account before continuing.');
    };
    try {
      await sameAccount();
      const destination = await withCheckoutLock(navigator.locks, expectedId, async () => {
        await sameAccount();
        if (kind === 'portal') return createMembershipPortal(expectedId);
        if (kind === 'status') {
          const checked = await getMembershipCheckoutStatus(expectedId);
          await sameAccount();
          if (checked.state === 'none') {
            clearConfirmedCheckout(window.localStorage, expectedId); setPending(null); setStorageError(''); setReturning(false); setPortalSuggested(false);
          } else if ('plan' in checked) {
            setPending(adoptServerCheckout(window.localStorage, expectedId, checked)); setStorageError(''); setPortalSuggested(false);
          } else if (checked.state === 'existing_subscription') setPortalSuggested(true);
          else if (checked.state === 'lifetime') void checkAccess(user, token);
          setCheckoutStatus(checked);
          return null;
        }
        // Recheck immediately before a sale. A stale badge cannot hide a lifetime purchase.
        const grant = await getEntitlement({ expectedUserId: expectedId, fresh: true });
        await sameAccount();
        if (grant) { setAccess(grant); throw new Error('Your purchased access is already connected. You do not need another membership.'); }
        const existing = readPendingCheckout(window.localStorage, expectedId);
        if (existing) {
          const checked = await getMembershipCheckoutStatus(expectedId);
          await sameAccount();
          if (checked.state === 'none') { clearConfirmedCheckout(window.localStorage, expectedId); setPending(null); }
          else if ('plan' in checked) setPending(adoptServerCheckout(window.localStorage, expectedId, checked));
          else if (checked.state === 'existing_subscription') { setPortalSuggested(true); throw new Error('You already have a subscription. Manage it from your account.'); }
          else if (checked.state === 'lifetime') { void checkAccess(user, token); return null; }
        }
        const reservation = reserveCheckout(window.localStorage, expectedId, plan!);
        setPending(reservation);
        return createMembershipCheckout(reservation.plan, reservation.requestId, expectedId);
      });
      await sameAccount();
      if (destination) window.location.assign(destination);
    } catch (issue) {
      if (generation.current === token) {
        setError(issueMessage(issue));
        if (issueCode(issue) === 'billing/existing_subscription_use_portal') setPortalSuggested(true);
        if (issueCode(issue) === 'billing/lifetime_access_already_covers_membership') void checkAccess(user, token);
        readPending(expectedId);
      }
    } finally { requestBusy.current = false; setBusy(null); }
  }
  if (!billingAvailable) return null;
  const verified = Boolean(user?.email_verified);
  const lifetime = access?.plan === 'lifetime';
  const membership = access?.source === 'subscription';
  const disabled = Boolean(busy) || status !== 'ready';
  const planCards = <div className="membership-plans">
    {storefront && !embedded && <div className="plan-free"><span className="plan-kicker">START EXPLORING</span><h3>Free</h3><p className="membership-price">$0</p><p>Find your first sound difference.</p><ul><li>Three exercises in every language</li><li>Unlimited practice on free exercises</li><li>Varied voices, with words hidden</li></ul><a className="button button-outline" href="/practice">Start listening free</a><p className="membership-fine">No card required.</p></div>}
    {(['monthly','annual'] as MembershipPlan[]).map(plan => <div key={plan} className={plan === 'annual' ? 'plan-annual' : 'plan-monthly'}><span className="plan-kicker">{plan === 'annual' ? 'SAVE 42% WITH ANNUAL' : 'KEEP IT FLEXIBLE'}</span><h3>{plan === 'annual' ? 'Premium annual' : 'Premium monthly'}</h3><p className="membership-price">{plan === 'annual' ? '$49' : '$7'}<span> USD / {plan === 'annual' ? 'year' : 'month'}</span></p><p>{plan === 'annual' ? 'About $4.08/month, billed yearly.' : 'Build a listening habit, one month at a time.'}</p><ul><li>Every exercise in all nine languages</li><li>Unlimited listening practice</li><li>Varied voices across each session</li><li>Immediate feedback and practice history</li></ul>{user?.email_verified ? <button className="button button-dark" disabled={disabled || Boolean(storageError)} onClick={() => void act('checkout',plan)}>{busy === 'checkout' ? 'Opening checkout…' : plan === 'annual' ? 'Choose annual' : 'Choose monthly'}</button> : <a className="button button-dark" href="/account#account-sign-in">{plan === 'annual' ? 'Get annual access' : 'Get monthly access'}</a>}<p className="membership-fine">{plan === 'annual' ? '$49 charged today and each year.' : '$7 charged today and each month.'} Renews until canceled.</p></div>)}
  </div>;
  return <section id="membership" className={`membership-panel ${storefront ? 'membership-storefront' : ''}`} aria-labelledby="membership-heading">
    <span className="account-plan-badge" role="status">{!identityReady || status === 'loading' ? 'Loading…' : status === 'error' ? 'Plan unavailable' : lifetime ? 'Lifetime' : membership ? 'Premium' : 'Free'}</span>
    <h2 id="membership-heading">{lifetime ? 'Your lifetime access is connected.' : membership ? 'Your membership is active.' : 'Choose your listening plan.'}</h2>
    {!identityReady ? <p role="status">Loading…</p> : !user ? <>{storefront && planCards}<p>Sign in to keep your membership connected to your account.</p><a className="button button-outline" href="/account#account-sign-in">Sign in</a><p>Already bought lifetime access? Use the verified email from your original purchase. <a href="/restore-access">Restore access →</a></p></> : !verified ? <>{storefront && planCards}<p>Verify your email before choosing or managing a membership. No payment has been started here.</p><a href="/account#account-sign-in">Check your email verification →</a></> : <>
      <div className="membership-status" aria-live="polite">
        {status === 'loading' ? <p>Loading…</p> : lifetime ? <p>Your original purchase is honored. You don’t need a subscription for the access it covers.</p> : membership ? <p>Your {access.plan === 'annual' ? 'annual' : 'monthly'} membership has current paid access, confirmed with the server.</p> : status === 'ready' ? <p>You’re on the Free plan. Explore more sounds with Premium.</p> : null}
      </div>
      {error && <p className="membership-error" role="alert">{error}</p>}
      {storageError && <p className="membership-error" role="alert">{storageError}</p>}
      {checkoutStatus && <p role="status">{checkoutStatus.state === 'none' ? 'No unfinished checkout remains. You can choose an available plan.'
        : checkoutStatus.state === 'open' ? `Your ${'plan' in checkoutStatus ? checkoutStatus.plan : ''} checkout is still open. You can resume it below.`
        : checkoutStatus.state === 'existing_subscription' ? 'A subscription is already connected. Open billing settings to manage it; this check does not confirm paid access.'
        : checkoutStatus.state === 'lifetime' ? 'Your lifetime purchase is connected. We are refreshing your access.'
        : 'Your previous checkout is still being checked. No new payment was started. Check access again shortly.'}</p>}
      {!lifetime && !membership && status === 'ready' && checkoutAvailable && !portalSuggested && <>
        <p>Membership unlocks every available exercise across all nine languages. The first three exercises in each language are free.</p>
        {planCards}
        <p className="membership-fine">Secure checkout with Stripe. Cancel renewal from your account; keep access through your paid period.</p>
      </>}
      {!lifetime && !membership && !checkoutAvailable && status === 'ready' && <p>New memberships are not on sale right now. Existing customers can still open billing settings when the service is available.</p>}
      {membership && <button className="button button-outline" disabled={disabled} onClick={() => void act('portal')}>{busy === 'portal' ? 'Opening…' : 'Manage subscription'}</button>}
      <details className="membership-help"><summary>Manage your membership or restore access</summary><div className="membership-actions"><button className="text-button" disabled={Boolean(busy) || status === 'loading'} onClick={() => user && void checkAccess(user, ++generation.current, true)}>Check access again</button>{!lifetime && !membership && <button className="text-button" disabled={disabled} onClick={() => void act('status')}>{busy === 'status' ? 'Checking checkout…' : 'Check checkout status'}</button>}{!lifetime && <button className="text-button" disabled={disabled} onClick={() => void act('portal')}>{busy === 'portal' ? 'Opening billing settings…' : 'Manage subscription'}</button>}</div>
      {!lifetime && <p className="membership-fine">Billing settings are for an existing billing account. Opening them does not create a membership.</p>}</details>
    </>}
  </section>;
}
