import { commerce, commercePath } from '../lib/commerce-i18n';
import { useEffect, useRef, useState } from 'react';
import { connectDeviceHistory, disconnectDeviceHistory, loadAccountProgress, type AccountProgress } from '../lib/progress-sync';
import { recommendReview } from '../lib/review-recommendation';
import { comparisonSources } from '../lib/audio-comparison';
import { fallbackAudioSourceLabel } from '../lib/session-audio-source';
import ReviewSuggestion from './ReviewSuggestion';
import ListeningPlan from './ListeningPlan';
import { OWNER_ENGLISH_COLLECTION, ownerEnglishHistoryHref } from '../lib/owner-audio-preview';
import MembershipPanel from './MembershipPanel';
import { billingAvailable } from '../lib/billing-client';
import type { PlanLanguage } from '../lib/listening-plan';
import { authReady, getSession, refreshSession, signInWithGoogle, signOut, type SessionUser } from '../lib/auth';
import EmailAuthPanel from './EmailAuthPanel';
import { getEntitlement, type Entitlement } from '../lib/entitlements';
import { Footer, Header, Icon, readProgress, type Language, type Progress, type PracticeSession } from './ui';

function GoogleMark() {
  return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 .9-3.4.9a6.1 6.1 0 0 1-5.7-4.2H2.9v2.7A10.1 10.1 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.3 13.7a6 6 0 0 1 0-3.4V7.6H2.9a10 10 0 0 0 0 8.8l3.4-2.7Z" /><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10.1 10.1 0 0 0-9.1 5.6l3.4 2.7A6.1 6.1 0 0 1 12 6.1Z" /></svg>;
}

export default function AccountPanel({ languages = [], authEnabled = authReady, planCatalog = [], locale = 'en' }: { languages?: Language[]; authEnabled?: boolean; planCatalog?: PlanLanguage[]; locale?: string }) {
  const t = commerce(locale); const path = (value: string) => commercePath(locale, value);
  const [progress, setProgress] = useState<Progress>({ sessions: [] });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [error, setError] = useState('');
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [reviewLanguage, setReviewLanguage] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const syncGeneration = useRef(0);
  useEffect(() => { setProgress(readProgress()); if (authEnabled) refreshSession().then(session => setUser(session?.user || null)).catch(() => setError(t('error'))); }, [authEnabled]);
  useEffect(() => {
    let cancelled = false;
    setEntitlement(null); setAccessError('');
    if (billingAvailable || !user?.email_verified) { setCheckingAccess(false); return; }
    setCheckingAccess(true);
    getEntitlement().then(access => { if (!cancelled) setEntitlement(access); }).catch(() => { if (!cancelled) setAccessError(t('error')); }).finally(() => { if (!cancelled) setCheckingAccess(false); });
    return () => { cancelled = true; };
  }, [user?.id, user?.email_verified]);
  useEffect(() => {
    const token = ++syncGeneration.current;
    const local = readProgress(); setProgress(local); setAccountId(null); setSyncEnabled(false); setSyncError(''); setSyncNotice('');
    if (!user?.email_verified) { setSyncBusy(false); return; }
    setSyncBusy(true);
    loadAccountProgress(local).then(result => {
      if (token === syncGeneration.current && result.accountId === user.id) applyAccountProgress(result);
    }).catch(() => {
      if (token === syncGeneration.current) setSyncError(t('error'));
    }).finally(() => { if (token === syncGeneration.current) setSyncBusy(false); });
    return () => { syncGeneration.current += 1; };
  }, [user?.id, user?.email_verified]);
  const sessions = progress.sessions.filter(session => session.mode === 'abx-cross-word');
  const audioOnlySessions = sessions.filter(session => session.textHintsUsed === false);
  const total = audioOnlySessions.reduce((sum, session) => sum + session.total, 0);
  const correct = audioOnlySessions.reduce((sum, session) => sum + session.correct, 0);
  const practicedLanguages = new Set(sessions.map(session => session.languageId)).size;
  const recommendation = recommendReview(languages, progress.sessions, { languageId: reviewLanguage || progress.preferredLanguage });
  function languageName(id: string) { return languages.find(item => item.id === id)?.name || id.charAt(0).toUpperCase() + id.slice(1); }
  function contrastName(languageId: string, contrastId: string) { return languages.find(item => item.id === languageId)?.contrasts.find(item => item.id === contrastId)?.label || contrastId.replace(/-/g, ' '); }
  function sessionHref(session: PracticeSession) {
    if (session.audioCollectionId === OWNER_ENGLISH_COLLECTION) return ownerEnglishHistoryHref(session.contrastId);
    const source = comparisonSources.find(source => source.collectionId === session.audioCollectionId);
    const params = `language=${encodeURIComponent(session.languageId)}&contrast=${encodeURIComponent(session.contrastId)}`;
    return source ? `/audio-comparison?${params}&source=${source.id}` : session.audioCollectionId === 'human-library-v1' ? `/human-audio-preview?${params}` : session.audioCollectionId === 'human-fr-u-y-v1' ? '/human-audio-preview' : `/practice?${params}`;
  }
  function sourceLabel(collectionId?: string) {
    if (collectionId === OWNER_ENGLISH_COLLECTION) return ' · English audio collection';
    const fallback = fallbackAudioSourceLabel(collectionId);
    if (fallback) return ` · ${fallback}`;
    const source = comparisonSources.find(source => source.collectionId === collectionId);
    return source ? ` · Audio comparison: ${source.name}` : collectionId === 'human-library-v1' ? ' · Audio collection' : collectionId === 'human-fr-u-y-v1' ? ' · Audio collection' : '';
  }
  function applyAccountProgress(result: AccountProgress) {
    setProgress(result.progress); setAccountId(result.accountId); setSyncEnabled(result.syncEnabled);
  }
  async function updateAccountHistory(connect: boolean) {
    if (!user || syncBusy) return;
    const token = ++syncGeneration.current; setSyncBusy(true); setSyncError(''); setSyncNotice('');
    try {
      // Upload only this device's own records, never the merged account display.
      const result = connect ? await connectDeviceHistory(readProgress()) : await loadAccountProgress(readProgress());
      if (token !== syncGeneration.current || result.accountId !== user.id) return;
      applyAccountProgress(result);
      setSyncNotice(connect ? 'Device history is connected. Future completed sessions will also save to this account on this device.' : 'Account history refreshed. No device sessions were uploaded.');
    } catch (issue) {
      if (token === syncGeneration.current) setSyncError(t('error'));
    } finally { if (token === syncGeneration.current) setSyncBusy(false); }
  }
  function pauseSync() {
    if (!accountId || syncBusy) return;
    try { disconnectDeviceHistory(accountId); setSyncEnabled(false); setSyncError(''); setSyncNotice('Future account saves are off on this device. Previously saved account sessions remain available.'); }
    catch { setSyncError(t('error')); }
  }
  async function authenticate() {
    setBusy(true); setError('');
    try { if (user) { await signOut(); setUser(null); } else { const session = await signInWithGoogle(); setUser(session?.user || null); } }
    catch (issue) {
      setError(t('error'));
    }
    finally { setBusy(false); }
  }
  async function recheckAccess() {
    if (!user || checkingAccess) return;
    setCheckingAccess(true); setAccessError('');
    try {
      const expectedId = user.id;
      const refreshed = await refreshSession(); setUser(refreshed?.user || null);
      if (!refreshed?.user.email_verified || refreshed.user.id !== expectedId) { setEntitlement(null); return; }
      const access = await getEntitlement();
      if ((await getSession())?.user.id === expectedId) setEntitlement(access);
    }
    catch { setAccessError(t('error')); }
    finally { setCheckingAccess(false); }
  }
  function exportHistory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `minimalpairs-practice-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  }
  const name = user?.user_metadata?.full_name?.split(' ')[0];
  return <><Header active="account" locale={locale} /><main className="account-main section-wrap"><div className="account-heading"><div><span className="eyebrow">{t('notebook')}</span><h1>{name ? t('welcome').replace('{name}', name) : t('counts')}</h1><p>{t('progressBody')}</p></div><a className="button button-dark" href={path(recommendation?.href || '/practice')}>{t(sessions.length ? 'continue' : 'practice')}<Icon name="arrow" /></a></div><div className="account-grid"><div className="account-primary"><div className="progress-stats"><div><span className="stats-icon"><Icon name="headphones" size={20} /></span><strong>{sessions.length}</strong><span>{t('sessions')}</span></div><div><span className="stats-icon"><Icon name="check" size={20} /></span><strong>{total > 0 ? `${Math.round(correct / total * 100)}%` : '—'}</strong><span>{t('accuracy')}</span></div><div><span className="stats-icon"><Icon name="globe" size={20} /></span><strong>{practicedLanguages}</strong><span>{t('languages')}</span></div></div><ListeningPlan catalog={planCatalog} locale={locale} />{recommendation && <div className="account-review"><label className="review-language">{t('continue')}<select value={recommendation.languageId} onChange={event => setReviewLanguage(event.target.value)}>{languages.map(language => <option value={language.id} key={language.id}>{language.name}</option>)}</select></label><ReviewSuggestion recommendation={recommendation} locale={locale} /></div>}<section className="history-panel"><div className="panel-heading"><h2>{t('history')}</h2>{sessions.length > 0 && <button onClick={exportHistory} className="text-button">{t('export')} <Icon name="arrow" size={14} /></button>}</div>{sessions.length ? <div className="history-list">{sessions.slice(-10).reverse().map(session => <div className="history-row" key={session.id}><span className="history-icon"><Icon name="headphones" size={20} /></span><div className="history-description"><strong>{languageName(session.languageId)}</strong><a href={path(sessionHref(session))}>{contrastName(session.languageId, session.contrastId)} · {t('revisit')} →</a><span>{session.textHintsUsed === true ? t('hints') : session.textHintsUsed === false ? t('audioOnly') : ''}</span></div><div className="history-score"><strong>{session.correct}<span>/{session.total}</span></strong><span>{new Date(session.completedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span></div></div>)}</div> : <div className="history-empty"><span><Icon name="book" size={30} /></span><h3>{t('empty')}</h3><p>{t('emptyBody')}</p><a href={path('/practice')} className="text-button">{t('practice')} <Icon name="arrow" size={16} /></a></div>}</section></div><aside className="account-aside"><section id="account-sign-in" className="signin-panel"><span className="signin-icon"><Icon name="user" size={24} /></span><h2>{t(user ? 'signedIn' : 'space')}</h2><p>{user ? user.email : t('signInBody')}</p><button className={`button ${user ? 'button-light' : 'google-button'}`} onClick={authenticate} disabled={busy || emailBusy || syncBusy || checkingAccess || !authEnabled}>{!user && <GoogleMark />}{t(busy ? 'loading' : user ? 'signOut' : 'signGoogle')}</button>{!authEnabled && <p className="configuration-note">{t('unavailable')}</p>}{error && <p className="audio-error" role="alert">{error}</p>}{!user && <details className="email-recovery"><summary>{t('emailExisting')}</summary><EmailAuthPanel locale={locale} user={null} disabled={busy || !authEnabled} onBusyChange={setEmailBusy} onSessionChange={session => { setUser(session?.user || null); setError(''); }} /></details>}{user && !user.email_verified && <EmailAuthPanel locale={locale} user={user} disabled={busy || !authEnabled} onBusyChange={setEmailBusy} onSessionChange={session => setUser(session?.user || null)} />}{user?.email_verified && <div className="account-sync"><p>{t('autoSave')}</p>{syncError && <p className="audio-error" role="alert">{syncError}</p>}</div>}</section>{!billingAvailable && <section className="lifetime-panel" id="lifetime"><h2>{t(entitlement?.active ? entitlement.plan === 'lifetime' ? 'lifetimeActive' : 'memberActive' : 'restore')}</h2><p>{t(entitlement?.active ? 'lifetimeBody' : 'restoreBody')}</p>{user && <div className="access-status" aria-live="polite">{!user.email_verified ? <p>{t('verify')}</p> : checkingAccess ? <p>{t('loading')}</p> : <>{accessError && <p className="audio-error">{accessError}</p>}<button className="text-button" onClick={recheckAccess}>{t('recheck')} <Icon name="replay" size={13} /></button></>}</div>}</section>}<MembershipPanel locale={locale} /><a href={path('/#languages')} className="account-language-link"><Icon name="globe" size={19} /><span>{t('nine')}</span><Icon name="arrow" size={18} /></a></aside></div></main><Footer locale={locale} /></>;
}
