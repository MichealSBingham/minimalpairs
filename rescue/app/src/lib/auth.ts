import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, onIdTokenChanged, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, EmailAuthProvider, linkWithCredential, sendEmailVerification, sendPasswordResetEmail, reload, getIdToken, validatePassword, checkActionCode, applyActionCode, verifyPasswordResetCode, confirmPasswordReset, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || '',
};
export const authReady = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
// Both capabilities are off unless an approved build explicitly enables them.
export const emailPasswordEnabled = import.meta.env.PUBLIC_EMAIL_PASSWORD_ENABLED === 'true';
export const authEmailsEnabled = import.meta.env.PUBLIC_AUTH_EMAILS_ENABLED === 'true';
export type SessionUser = { id: string; email?: string; email_verified: boolean; providers: string[]; user_metadata: { full_name?: string } };
export type Session = { user: SessionUser } | null;
let app: FirebaseApp | undefined;
export function getApp() {
  if (!authReady) return null;
  app ??= getApps()[0] || initializeApp(config);
  return app;
}
export function getDatabase() {
  const configured = getApp();
  return configured ? getFirestore(configured) : null;
}
function session(user: User | null): Session {
  return user ? { user: { id: user.uid, email: user.email || undefined, email_verified: user.emailVerified, providers: user.providerData.map(provider => provider.providerId), user_metadata: { full_name: user.displayName || undefined } } } : null;
}
export async function getSession() {
  const configured = getApp();
  if (!configured || typeof window === 'undefined') return null;
  const auth = getAuth(configured);
  await auth.authStateReady();
  return session(auth.currentUser);
}
/** Read-only observer: account changes must invalidate billing work in other tabs. */
export function observeSession(listener: (value: Session) => void): () => void {
  const configured = getApp();
  if (!configured || typeof window === 'undefined') { listener(null); return () => {}; }
  let previous: string | undefined;
  return onIdTokenChanged(getAuth(configured), user => {
    const value = session(user);
    const fingerprint = JSON.stringify(value);
    // Verification/email changes matter; routine token refreshes with the same
    // account snapshot must not invalidate an already-running billing request.
    if (fingerprint === previous) return;
    previous = fingerprint;
    listener(value);
  });
}
export async function signInWithGoogle() {
  const configured = getApp();
  if (!configured) throw new Error('Account connection is not configured for this preview. Your practice still works on this device.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(getAuth(configured), provider);
  return session(result.user);
}
export async function signOut() {
  const configured = getApp();
  if (configured) await firebaseSignOut(getAuth(configured));
}

function failure(code: string, message: string) { return Object.assign(new Error(message), { code }); }
function requireEmailProvider() {
  if (!emailPasswordEnabled) throw failure('app/email-provider-disabled', 'Email and password sign-in is not available yet. Google sign-in and guest practice are still available.');
}
function requireEmailDelivery() {
  if (!authEmailsEnabled) throw failure('app/email-delivery-disabled', 'Verification and password-reset emails are not available yet. No email was sent.');
}
function configuredAuth() {
  const configured = getApp();
  if (!configured || typeof window === 'undefined') throw failure('app/auth-unavailable', 'Account connection is not available. Your device practice is still available.');
  return getAuth(configured);
}
const normalizeEmail = (email: string) => email.trim().toLowerCase();
async function passwordPolicy(password: string) {
  if (password.length < 12 || password.length > 4096) throw failure('app/password-policy', 'Choose a password with at least 12 characters.');
  if (!(await validatePassword(configuredAuth(), password)).isValid) throw failure('app/password-policy', 'This password does not meet the account requirements. Try a longer password with upper and lower case letters, a number and a symbol.');
}
function assertSameUser(user: User) {
  if (configuredAuth().currentUser?.uid !== user.uid) throw failure('app/account-changed', 'Your signed-in account changed. Please try again.');
}

/** Reload server verification and refresh token claims before checking purchased access. */
export async function refreshSession(): Promise<Session> {
  if (!authReady || typeof window === 'undefined') return null;
  const auth = configuredAuth(); await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  await reload(user); assertSameUser(user);
  await getIdToken(user, true); assertSameUser(user);
  return session(user);
}

/** Explicit billing actions use a fresh token for the account shown to the user. */
export async function getFreshVerifiedIdToken(expectedUserId: string): Promise<string> {
  const auth = configuredAuth(); await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw failure('app/sign-in-required', 'Sign in before managing a membership.');
  if (!expectedUserId || user.uid !== expectedUserId) throw failure('app/account-changed', 'Your signed-in account changed. Please try again.');
  await reload(user); assertSameUser(user);
  if (!user.email || !user.emailVerified) throw failure('app/verification-required', 'Verify your email before managing a membership.');
  const token = await getIdToken(user, true); assertSameUser(user);
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) throw failure('app/auth-unavailable', 'Account verification is unavailable. Please sign in again.');
  // Never place this token in a URL, analytics event, history record or storage.
  return token;
}

export async function signInWithEmail(email: string, password: string): Promise<Session> {
  requireEmailProvider();
  const result = await signInWithEmailAndPassword(configuredAuth(), normalizeEmail(email), password);
  return session(result.user);
}

/** Creating an account never sends an email. Verification is a separate explicit action. */
export async function createEmailAccount(email: string, password: string): Promise<Session> {
  requireEmailProvider(); requireEmailDelivery();
  const auth = configuredAuth(); await auth.authStateReady();
  if (auth.currentUser) throw failure('app/already-signed-in', 'You are already signed in. Add a password to this account or sign out before creating another.');
  await passwordPolicy(password);
  if (auth.currentUser) throw failure('app/account-changed', 'Your signed-in account changed. Please try again.');
  const result = await createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
  return session(result.user);
}

/** Link to the current verified identity, never create/delete/merge a replacement UID. */
export async function addPasswordToCurrentAccount(password: string): Promise<Session> {
  requireEmailProvider();
  await refreshSession();
  const user = configuredAuth().currentUser;
  if (!user?.email || !user.emailVerified) throw failure('app/verification-required', 'Verify your current email before adding a password.');
  if (user.providerData.some(provider => provider.providerId === 'password')) throw failure('auth/provider-already-linked', 'This account already has a password. Use password recovery if needed.');
  await passwordPolicy(password); assertSameUser(user);
  const result = await linkWithCredential(user, EmailAuthProvider.credential(user.email, password));
  assertSameUser(user);
  if (result.user.uid !== user.uid) throw failure('app/account-changed', 'Your signed-in account changed. Please sign in again.');
  return session(result.user);
}

function actionSettings() { return { url: new URL('/account', window.location.origin).href, handleCodeInApp: false }; }
export async function requestVerificationEmail(): Promise<'already-verified' | 'requested'> {
  requireEmailDelivery(); // Must remain before every SDK operation that can send.
  const auth = configuredAuth(); await auth.authStateReady();
  const user = auth.currentUser;
  if (!user?.email) throw failure('app/sign-in-required', 'Sign in before requesting a verification email.');
  await reload(user); assertSameUser(user);
  if (user.emailVerified) return 'already-verified';
  auth.languageCode = 'en';
  await sendEmailVerification(user, actionSettings());
  return 'requested';
}
export async function requestPasswordReset(email: string): Promise<void> {
  requireEmailDelivery(); requireEmailProvider();
  const auth = configuredAuth(); auth.languageCode = 'en';
  try { await sendPasswordResetEmail(auth, normalizeEmail(email), actionSettings()); }
  catch (issue) {
    // Keep the same response regardless of whether a password account exists.
    if (!(issue && typeof issue === 'object' && 'code' in issue && issue.code === 'auth/user-not-found')) throw issue;
  }
}

export type EmailAction = { mode: 'verifyEmail' | 'resetPassword'; code: string };
export function parseEmailAction(search: string): EmailAction {
  const params = new URLSearchParams(search);
  const mode = params.get('mode'); const code = params.get('oobCode');
  if (params.getAll('mode').length !== 1 || params.getAll('oobCode').length !== 1 || !['verifyEmail', 'resetPassword'].includes(mode || '') || !code || !/^[A-Za-z0-9_-]{10,2048}$/.test(code) || (params.has('apiKey') && params.get('apiKey') !== config.apiKey)) throw failure('auth/invalid-action-code', 'This account link is not valid.');
  // continueUrl, language and incoming apiKey never configure auth or navigation.
  return { mode: mode as EmailAction['mode'], code };
}
export async function inspectEmailAction(action: EmailAction): Promise<void> {
  const auth = configuredAuth();
  if (action.mode === 'resetPassword') { await verifyPasswordResetCode(auth, action.code); return; }
  const information = await checkActionCode(auth, action.code);
  if (information.operation !== 'VERIFY_EMAIL') throw failure('auth/invalid-action-code', 'This is not an email verification link.');
}
export async function completeEmailVerification(code: string): Promise<{ session: Session; refreshed: boolean }> {
  await inspectEmailAction({ mode: 'verifyEmail', code });
  await applyActionCode(configuredAuth(), code);
  try { return { session: await refreshSession(), refreshed: true }; }
  catch { return { session: null, refreshed: false }; }
}
export async function completePasswordReset(code: string, password: string): Promise<void> {
  await verifyPasswordResetCode(configuredAuth(), code);
  await passwordPolicy(password);
  await confirmPasswordReset(configuredAuth(), code, password);
}

export function authErrorMessage(issue: unknown): string {
  const code = issue && typeof issue === 'object' && 'code' in issue ? String(issue.code) : '';
  if (code.startsWith('app/') && issue instanceof Error) return issue.message;
  const messages: Record<string, string> = {
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/invalid-credential': 'We could not sign you in. Check your details, or use Google if that is how you first signed in.',
    'auth/wrong-password': 'We could not sign you in. Check your details, or use Google if that is how you first signed in.',
    'auth/user-not-found': 'We could not sign you in. Check your details, or create an account if you have not used this rebuilt site before.',
    'auth/email-already-in-use': 'This email already has an account. Sign in or reset its password. If you previously used Google, continue with Google; do not create another account.',
    'auth/account-exists-with-different-credential': 'Use your existing sign-in method for this email. If you used Google, continue with Google. Your existing history stays with that account.',
    'auth/credential-already-in-use': 'That sign-in method belongs to another account. Your current account has not been merged or replaced. Use the original sign-in method.',
    'auth/provider-already-linked': 'This account already has a password. Use password recovery if needed.',
    'auth/requires-recent-login': 'Sign out and sign back in with your existing method, then try again. Your saved history remains attached to that account.',
    'auth/operation-not-allowed': 'Email and password sign-in is not available yet. Google sign-in and guest practice are still available.',
    'auth/weak-password': 'Choose a stronger password with at least 12 characters.',
    'auth/password-does-not-meet-requirements': 'Choose a longer password with upper and lower case letters, a number and a symbol.',
    'auth/too-many-requests': 'Too many attempts. Wait a little before trying again.',
    'auth/network-request-failed': 'We could not connect. Check your connection and try again.',
    'auth/expired-action-code': 'This link has expired. Return to your account page and request a new one.',
    'auth/invalid-action-code': 'This link is invalid or has already been used. Return to your account page to check your status or request a new link.',
    'auth/user-disabled': 'This account cannot sign in. Your device practice is still available.',
  };
  return messages[code] || 'The account action could not be completed. Please try again. Your device history is still available.';
}
