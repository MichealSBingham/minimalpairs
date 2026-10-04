import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { authErrorMessage, completeEmailVerification, completePasswordReset, inspectEmailAction, parseEmailAction, type EmailAction } from '../lib/auth';
import { Footer, Header } from './ui';

export default function EmailActionPanel() {
  const [action, setAction] = useState<EmailAction | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'working' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState('Checking your account link…');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const originalSearch = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    try {
      originalSearch.current ??= window.location.search;
      // Drop bearer codes from the address bar before any subsequent navigation.
      window.history.replaceState(null, '', '/auth/action');
      const parsed = parseEmailAction(originalSearch.current);
      setAction(parsed);
      inspectEmailAction(parsed).then(() => { if (!cancelled) { setStatus('ready'); setMessage(parsed.mode === 'verifyEmail' ? 'Confirm that you want to verify the email linked to this account.' : 'Choose a new password for the account associated with this reset link.'); } }).catch(issue => { if (!cancelled) { setStatus('error'); setMessage(authErrorMessage(issue)); } });
    } catch (issue) { setStatus('error'); setMessage(authErrorMessage(issue)); }
    return () => { cancelled = true; };
  }, []);
  async function complete(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || status !== 'ready') return;
    if (action.mode === 'resetPassword' && password !== confirm) { setMessage('The two passwords do not match.'); return; }
    setStatus('working');
    try {
      if (action.mode === 'verifyEmail') { const result = await completeEmailVerification(action.code); setMessage(result.refreshed ? 'Your email is verified. Return to your account and sign in with the verified email to check purchased access.' : 'Your email is verified. Sign in again to refresh your account access.'); }
      else { await completePasswordReset(action.code, password); setMessage('Your password has been updated. Sign in with your new password. Your account identity and saved history have not been replaced.'); }
      setPassword(''); setConfirm(''); setStatus('done');
    } catch (issue) { setMessage(authErrorMessage(issue)); setStatus('ready'); }
  }
  return <><Header active="account" /><main className="auth-action-main section-wrap"><section className="auth-action-card"><span className="eyebrow">YOUR MINIMALPAIRS ACCOUNT</span><h1>{status === 'done' ? 'Your account is ready.' : action?.mode === 'resetPassword' ? 'Choose a new password.' : 'Confirm your email.'}</h1><p role={status === 'error' ? 'alert' : 'status'}>{message}</p>{(status === 'ready' || status === 'working') && action && <form className="email-auth" onSubmit={complete}>{action.mode === 'resetPassword' && <><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={4096} required value={password} onChange={event => setPassword(event.target.value)} disabled={status === 'working'} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} maxLength={4096} required value={confirm} onChange={event => setConfirm(event.target.value)} disabled={status === 'working'} /></label><span className="password-help">Use at least 12 characters.</span></>}<button className="button button-dark" disabled={status === 'working'}>{status === 'working' ? 'One moment…' : action.mode === 'verifyEmail' ? 'Verify this email' : 'Save new password'}</button></form>}<a className="text-button" href="/account">Return to your account →</a><p className="configuration-note">No email is sent from this page. Purchased access is checked only after verified sign-in.</p></section></main><Footer /></>;
}
