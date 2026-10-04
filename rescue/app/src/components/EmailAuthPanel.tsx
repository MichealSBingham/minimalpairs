import { commerce } from '../lib/commerce-i18n';
import { useState, type SubmitEvent } from 'react';
import { addPasswordToCurrentAccount, authEmailsEnabled, authErrorMessage, createEmailAccount, emailPasswordEnabled, refreshSession, requestPasswordReset, requestVerificationEmail, signInWithEmail, type Session, type SessionUser } from '../lib/auth';

export default function EmailAuthPanel({ user, disabled = false, locale = 'en', onSessionChange, onBusyChange }: { locale?: string; user: SessionUser | null; disabled?: boolean; onSessionChange: (session: Session) => void; onBusyChange?: (busy: boolean) => void }) {
  const t = commerce(locale);
  const [mode, setMode] = useState<'signin' | 'create' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = busy || disabled;
  async function run(operation: () => Promise<void>) {
    if (locked) return;
    setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    try { await operation(); }
    catch (issue) { setError(locale === 'en' ? authErrorMessage(issue) : t('error')); }
    finally { setPassword(''); setConfirm(''); setBusy(false); onBusyChange?.(false); }
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((mode === 'create' || user) && password !== confirm) { setError(t('passwordMismatch')); return; }
    await run(async () => {
      if (user) { onSessionChange(await addPasswordToCurrentAccount(password)); setNotice(t('passwordConnected')); }
      else if (mode === 'reset') { await requestPasswordReset(email); setNotice(t('resetRequested')); }
      else if (mode === 'create') { onSessionChange(await createEmailAccount(email, password)); setNotice(t('createdAccount')); }
      else onSessionChange(await signInWithEmail(email, password));
    });
  }
  function changeMode(value: typeof mode) { setMode(value); setError(''); setNotice(''); setPassword(''); setConfirm(''); }
  const messages = <>{error && <p className="audio-error" role="alert">{error}</p>}{notice && <p className="auth-notice" role="status">{notice}</p>}</>;
  if (user && !user.email_verified) return <section className="email-auth verification-panel" aria-label={t('verify')}><h3>{t('verify')}</h3><button className="button button-dark" disabled={locked || !authEmailsEnabled} onClick={() => void run(async () => { const outcome = await requestVerificationEmail(); if (outcome === 'already-verified') { onSessionChange(await refreshSession()); setNotice(t('verified')); } else setNotice(t('verificationSent')); })}>{t(busy ? 'loading' : 'sendVerification')}</button>{!authEmailsEnabled && <p className="configuration-note">{t('unavailable')}</p>}<button className="text-button auth-check-verification" disabled={locked} onClick={() => void run(async () => { const refreshed = await refreshSession(); onSessionChange(refreshed); setNotice(t(refreshed?.user.email_verified ? 'verified' : 'verificationSent')); })}>{t('recheck')}</button>{messages}</section>;
  if (user && user.providers.includes('password')) return <div className="email-auth"><p className="configuration-note">{t('passwordConnected')}</p>{messages}</div>;
  if (user) return <details className="email-auth"><summary>{t('addPassword')}</summary><p>{user.email}</p>{!emailPasswordEnabled && <p className="configuration-note">{t('unavailable')}</p>}<form onSubmit={submit}><label>{t('password')}<input type="password" autoComplete="new-password" minLength={12} maxLength={4096} required value={password} onChange={event => setPassword(event.target.value)} disabled={locked || !emailPasswordEnabled} /></label><label>{t('confirmPassword')}<input type="password" autoComplete="new-password" minLength={12} maxLength={4096} required value={confirm} onChange={event => setConfirm(event.target.value)} disabled={locked || !emailPasswordEnabled} /></label><span className="password-help">{t('passwordHelp')}</span><button className="button button-light" disabled={locked || !emailPasswordEnabled}>{t(busy ? 'loading' : 'addPassword')}</button></form>{messages}</details>;
  return <details className="email-auth" id="email-signin"><summary>{t('signEmail')}</summary><p>{t('restoreBody')}</p>{!emailPasswordEnabled && <p className="configuration-note">{t('unavailable')}</p>}<div className="email-auth-modes" aria-label={t('emailExisting')}>{(['signin', 'create', 'reset'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} disabled={locked} onClick={() => changeMode(value)}>{t(value === 'signin' ? 'signIn' : value === 'create' ? 'createAccount' : 'resetPassword')}</button>)}</div><form onSubmit={submit}><label>{t('email')}<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} disabled={locked || !emailPasswordEnabled} /></label>{mode !== 'reset' && <label>{t('password')}<input type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required minLength={mode === 'create' ? 12 : undefined} maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} disabled={locked || !emailPasswordEnabled} /></label>}{mode === 'create' && <><label>{t('confirmPassword')}<input type="password" autoComplete="new-password" required minLength={12} maxLength={4096} value={confirm} onChange={event => setConfirm(event.target.value)} disabled={locked || !emailPasswordEnabled} /></label><span className="password-help">{t('passwordHelp')}</span></>}<button className="button button-light" disabled={locked || !emailPasswordEnabled || (mode !== 'signin' && !authEmailsEnabled)}>{t(busy ? 'loading' : mode === 'signin' ? 'signEmail' : mode === 'create' ? 'createAccount' : 'resetPassword')}</button></form>{mode !== 'signin' && !authEmailsEnabled && <p className="configuration-note">{t('unavailable')}</p>}{messages}</details>;
}
