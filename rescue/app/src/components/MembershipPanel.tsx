import {diagnosticReturnPath, diagnosticReturnLabel} from '../lib/diagnostic-return';
import { useMeasuredExposure } from './useMeasuredExposure';
import { trackMeasurement } from '../lib/measurement';
import { useEffect, useRef, useState } from 'react';
import { getSession, observeSession, refreshSession, type SessionUser } from '../lib/auth';
import { billingAvailable, checkoutAvailable, createMembershipCheckout, createMembershipPortal, getMembershipCheckoutStatus, type MembershipPlan, type CheckoutStatus } from '../lib/billing-client';
import { getEntitlement, type Entitlement } from '../lib/entitlements';
import { checkoutStorageKey, clearConfirmedCheckout, readPendingCheckout, reserveCheckout, adoptServerCheckout, withCheckoutLock, type PendingCheckout } from '../lib/billing-checkout-state';
import '../styles/membership.css';
import { commerce, commercePath } from '../lib/commerce-i18n';

type AccessState = 'loading' | 'ready' | 'error';

const issueCode = (issue: unknown) => issue && typeof issue === 'object' && 'code' in issue ? issue.code : '';

/** No checkout or portal request occurs on mount, identity change, focus or return. */
export default function MembershipPanel({ storefront = false, embedded = false, locale = 'en' }: { storefront?: boolean; embedded?: boolean; locale?: string }) {
  const t = commerce(locale); const path = (value: string) => commercePath(locale, value);
  const surface = embedded ? 'practice' : storefront ? 'pricing' : 'account';
  const selectPlan = (plan: MembershipPlan) => trackMeasurement('plan_selected',{surface,ui_locale:locale,plan});
  const issueMessage = (_issue: unknown) => t('error');
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
  const [reportReturn, setReportReturn] = useState<string | null>(null);
  useEffect(() => { setReportReturn(diagnosticReturnPath(window.localStorage)); }, []);
  const [portalSuggested, setPortalSuggested] = useState(false);
  const generation = useRef(0);
  const requestBusy = useRef(false);
  const currentUid = useRef<string | null>(null);
  const [planExposureNode, setPlanExposureNode] = useState<HTMLDivElement | null>(null);
  useMeasuredExposure(planExposureNode, `${surface}:${locale}`, 'plans_view', {surface,ui_locale:locale,access_tier:'free'});

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
        if (new URLSearchParams(window.location.search).get('billing') === 'return') {
          const report = diagnosticReturnPath(window.localStorage);
          if (report) window.location.replace(path(report));
        }
        try { clearConfirmedCheckout(window.localStorage, expectedUser.id); setPending(null); setStorageError(''); }
        catch { setStorageError(t('error')); }
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
    if (kind === 'checkout' && plan) selectPlan(plan);
    const expectedId = user.id;
    const token = generation.current;
    let checkoutPlan = plan;
    let resumingOpenCheckout = false;
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
          else if ('plan' in checked) { setPending(adoptServerCheckout(window.localStorage, expectedId, checked)); resumingOpenCheckout = checked.state === 'open' && checked.plan === plan; }
          else if (checked.state === 'existing_subscription') { setPortalSuggested(true); throw new Error('You already have a subscription. Manage it from your account.'); }
          else if (checked.state === 'lifetime') { void checkAccess(user, token); return null; }
        }
        const reservation = reserveCheckout(window.localStorage, expectedId, plan!);
        setPending(reservation);
        checkoutPlan = reservation.plan;
        return createMembershipCheckout(reservation.plan, reservation.requestId, expectedId);
      });
      await sameAccount();
      if (destination) {
        if(kind === 'checkout') {
          trackMeasurement('begin_checkout',{surface,ui_locale:locale,plan:checkoutPlan});
          if (resumingOpenCheckout) trackMeasurement('checkout_resumed',{surface,ui_locale:locale,plan:checkoutPlan});
        }
        if(kind === 'portal') trackMeasurement('billing_portal_open',{surface,ui_locale:locale});
        window.location.assign(destination);
      }
    } catch (issue) {
      if(kind === 'checkout') trackMeasurement('checkout_error',{surface,ui_locale:locale,plan,outcome:'failed'});
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
    {storefront && !embedded && <div className="plan-free"><span className="plan-kicker">{t('explore')}</span><h3>{t('free')}</h3><p className="membership-price">$0</p><p>{t('freePitch')}</p><ul><li>{t('freeDiagnostic')}</li><li>{t('freeExercises')}</li><li>{t('freeUnlimited')}</li><li>{t('voicesHidden')}</li></ul><a className="button button-outline" href={path('/practice')}>{t('startFree')}</a><p className="membership-fine">{t('noCard')}</p></div>}
    {(['monthly','lifetime'] as MembershipPlan[]).map(plan => <div key={plan} ref={plan === 'monthly' ? setPlanExposureNode : undefined} className={plan === 'lifetime' ? 'plan-lifetime' : 'plan-monthly'}><span className="plan-kicker">{t(plan === 'lifetime' ? 'payOnce' : 'flexible')}</span><h3>{t(plan)}</h3><p className="membership-price">{plan === 'lifetime' ? '$29' : '$7'}<span> USD {plan === 'lifetime' ? t('once') : `/ ${t('month')}`} </span></p><p>{t(plan === 'lifetime' ? 'lifetimeDetail' : 'monthlyDetail')}</p><ul><li>{t('allExercises')}</li><li>{t('unlimited')}</li><li>{t('voices')}</li><li>{t('feedback')}</li></ul>{user?.email_verified ? <button className="button button-dark" disabled={disabled || Boolean(storageError)} onClick={() => void act('checkout',plan)}>{busy === 'checkout' ? t('opening') : pending?.plan === plan ? t('resumeCheckout') : t(plan === 'lifetime' ? 'chooseLifetime' : 'chooseMonthly')}</button> : <a className="button button-dark" onClick={() => selectPlan(plan)} href={path('/account#account-sign-in')}>{t(plan === 'lifetime' ? 'chooseLifetime' : 'chooseMonthly')}</a>}<p className="membership-fine">{t(plan === 'lifetime' ? 'lifetimeCharge' : 'monthlyCharge')}</p></div>)}
  </div>;
  return <section id="membership" className={`membership-panel ${storefront ? 'membership-storefront' : ''}`} aria-labelledby="membership-heading">
    {!embedded && reportReturn && <p><a className="button button-outline" href={path(reportReturn)}>{diagnosticReturnLabel(locale)} →</a></p>}
    <span className="account-plan-badge" role="status">{!identityReady || status === 'loading' ? t('loading') : status === 'error' ? t('unavailable') : lifetime ? t('lifetime') : membership ? t('premium') : t('free')}</span>
    <h2 id="membership-heading">{t(lifetime ? 'lifetimeActive' : membership ? 'memberActive' : 'choose')}</h2>
    {!identityReady ? <p role="status">{t('loading')}</p> : !user ? <>{storefront && planCards}<p>{t('signInBody')}</p><a className="button button-outline" href={path('/account#account-sign-in')}>{t('signGoogle')}</a><p>{t('restoreBody')} <a href={path('/account#account-sign-in')}>{t('restore')} →</a></p></> : !verified ? <>{storefront && planCards}<p>{t('verify')}</p><a href={path('/account#account-sign-in')}>{t('account')} →</a></> : <>
      <div className="membership-status" aria-live="polite">{status === 'loading' ? <p>{t('loading')}</p> : lifetime ? <p>{t('lifetimeBody')}</p> : membership ? <p>{t('memberActive')}</p> : status === 'ready' ? <p>{t('freeBody')}</p> : null}</div>
      {error && <p className="membership-error" role="alert">{error} <a href={path('/support')}>{t('support')} →</a></p>}
      {storageError && <p className="membership-error" role="alert">{storageError}</p>}
      {checkoutStatus && <p role="status">{t(checkoutStatus.state === 'none' ? 'checkoutNone' : checkoutStatus.state === 'open' ? 'checkoutOpen' : checkoutStatus.state === 'existing_subscription' ? 'manage' : checkoutStatus.state === 'lifetime' ? 'lifetimeActive' : 'checkoutPending')}</p>}
      {!lifetime && !membership && status === 'ready' && checkoutAvailable && !portalSuggested && <>{planCards}<p className="membership-fine">{t('secure')}</p></>}
      {!lifetime && !membership && !checkoutAvailable && status === 'ready' && <p>{t('unavailable')}</p>}
      {membership && <button className="button button-outline" disabled={disabled} onClick={() => void act('portal')}>{busy === 'portal' ? t('opening') : t('manage')}</button>}
      <details className="membership-help"><summary>{t('helpAccess')}</summary><div className="membership-actions"><button className="text-button" disabled={Boolean(busy) || status === 'loading'} onClick={() => user && void checkAccess(user, ++generation.current, true)}>{t('recheck')}</button>{!lifetime && !membership && <button className="text-button" disabled={disabled} onClick={() => void act('status')}>{busy === 'status' ? t('loading') : t('checkoutStatus')}</button>}{!lifetime && <button className="text-button" disabled={disabled} onClick={() => void act('portal')}>{busy === 'portal' ? t('opening') : t('manage')}</button>}</div></details>
    </>}
  </section>;
}
