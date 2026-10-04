import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const user = (patch = {}) => ({ uid: 'existing-uid', email: 'learner@example.invalid', emailVerified: false, displayName: null, providerData: [{ providerId: 'password' }], ...patch });
const error = code => Object.assign(new Error(code), { code });
function client(options = {}) {
  const env = { PUBLIC_FIREBASE_API_KEY: 'test-api-key', PUBLIC_FIREBASE_AUTH_DOMAIN: 'test.invalid', PUBLIC_FIREBASE_PROJECT_ID: 'demo-auth-test', PUBLIC_FIREBASE_APP_ID: 'test-app', ...options.env };
  const source = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', JSON.stringify(env));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const auth = { currentUser: options.user ?? null, authStateReady: async () => {}, languageCode: undefined };
  const calls = [];
  let tokenListener;
  const app = {};
  const call = (name, detail) => { calls.push({ name, detail }); if (options.fail === name) throw error(options.errorCode || 'auth/network-request-failed'); };
  const sdk = {
    getAuth: () => auth,
    onIdTokenChanged: (_auth, listener) => { tokenListener = listener; listener(auth.currentUser); return () => { tokenListener = undefined; }; },
    GoogleAuthProvider: class { setCustomParameters(parameters) { call('google-parameters', parameters); } },
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    signInWithPopup: async () => { call('google-signin'); auth.currentUser = user({ emailVerified: true, providerData: [{ providerId: 'google.com' }] }); return { user: auth.currentUser }; },
    signOut: async () => { call('signout'); auth.currentUser = null; },
    signInWithEmailAndPassword: async (_auth, email, password) => { call('password-signin', { email, password }); auth.currentUser = user({ email }); return { user: auth.currentUser }; },
    createUserWithEmailAndPassword: async (_auth, email, password) => { call('create', { email, password }); auth.currentUser = user({ uid: 'new-uid', email }); return { user: auth.currentUser }; },
    validatePassword: async () => { call('password-policy'); if (options.switchOnPolicy) auth.currentUser = options.switchOnPolicy; return { isValid: options.validPassword !== false }; },
    reload: async current => { call('reload', current.uid); if (options.verifyOnReload) current.emailVerified = true; if (options.switchOnReload) auth.currentUser = options.switchOnReload; },
    getIdToken: async (current, force) => { call('token', { uid: current.uid, force }); if (options.switchOnToken) auth.currentUser = options.switchOnToken; return options.idToken ?? 'fake-token'; },
    linkWithCredential: async (current, credential) => { call('link', { uid: current.uid, email: credential.email }); current.providerData.push({ providerId: 'password' }); return { user: options.linkResult || current }; },
    sendEmailVerification: async (current, settings) => { call('send-verification', { uid: current.uid, settings }); },
    sendPasswordResetEmail: async (_auth, email, settings) => { call('send-reset', { email, settings }); },
    checkActionCode: async (_auth, code) => { call('check-code', code); return { operation: options.operation || 'VERIFY_EMAIL', data: { email: 'learner@example.invalid' } }; },
    applyActionCode: async (_auth, code) => { call('apply-code', code); },
    verifyPasswordResetCode: async (_auth, code) => { call('check-reset', code); return 'learner@example.invalid'; },
    confirmPasswordReset: async (_auth, code, password) => { call('confirm-reset', { code, password }); },
  };
  const dependencies = { 'firebase/app': { getApps: () => [app], initializeApp: () => app }, 'firebase/auth': sdk, 'firebase/firestore': { getFirestore: () => ({}) } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports, { location: { origin: 'https://preview.example.invalid' } });
  return { api: module.exports, auth, calls, emitTokenChange: () => tokenListener?.(auth.currentUser) };
}
const enabled = { PUBLIC_EMAIL_PASSWORD_ENABLED: 'true', PUBLIC_AUTH_EMAILS_ENABLED: 'true' };
const names = subject => subject.calls.map(call => call.name);

test('session observer propagates verification/account changes but ignores unchanged token refreshes', () => {
  const subject = client({ user: user() }); const seen = [];
  const stop = subject.api.observeSession(value => seen.push(value));
  assert.equal(seen.length, 1); assert.equal(seen[0].user.email_verified, false);
  subject.emitTokenChange(); subject.emitTokenChange(); assert.equal(seen.length, 1);
  subject.auth.currentUser.emailVerified = true; subject.emitTokenChange();
  assert.equal(seen.length, 2); assert.equal(seen[1].user.email_verified, true);
  subject.emitTokenChange(); assert.equal(seen.length, 2);
  subject.auth.currentUser = user({ uid: 'other-uid', emailVerified: true }); subject.emitTokenChange();
  assert.equal(seen[2].user.id, 'other-uid');
  subject.auth.currentUser = null; subject.emitTokenChange(); assert.equal(seen[3], null);
  stop(); subject.auth.currentUser = user(); subject.emitTokenChange(); assert.equal(seen.length, 4);
  assert.deepEqual(subject.calls, []);
});

test('email delivery fails closed before SDK sends for omitted or nonliteral flags', async () => {
  for (const flag of [undefined, 'false', 'TRUE', '1', true]) {
    const subject = client({ env: { PUBLIC_AUTH_EMAILS_ENABLED: flag, PUBLIC_EMAIL_PASSWORD_ENABLED: 'true' }, user: user() });
    assert.equal(subject.api.authEmailsEnabled, false);
    await assert.rejects(subject.api.requestVerificationEmail(), { code: 'app/email-delivery-disabled' });
    await assert.rejects(subject.api.requestPasswordReset('learner@example.invalid'), { code: 'app/email-delivery-disabled' });
    assert.deepEqual(subject.calls, []);
  }
});

test('disabled password provider cannot sign in, create, reset or link even if emails enabled', async () => {
  const subject = client({ env: { PUBLIC_AUTH_EMAILS_ENABLED: 'true' } });
  for (const operation of [() => subject.api.signInWithEmail('a@example.invalid', 'password'), () => subject.api.createEmailAccount('a@example.invalid', 'new-password-123'), () => subject.api.requestPasswordReset('a@example.invalid'), () => subject.api.addPasswordToCurrentAccount('new-password-123')]) await assert.rejects(operation(), { code: 'app/email-provider-disabled' });
  assert.deepEqual(subject.calls, []);
});

test('new account creation is separate from email delivery and never marks verification locally', async () => {
  const subject = client({ env: enabled });
  const result = await subject.api.createEmailAccount(' Learner@Example.invalid ', 'new-password-123');
  assert.equal(result.user.id, 'new-uid');
  assert.equal(result.user.email, 'learner@example.invalid');
  assert.equal(result.user.email_verified, false);
  assert.deepEqual(names(subject), ['password-policy', 'create']);
});

test('sign-in sends no email and does not replace UID through a create fallback', async () => {
  const subject = client({ env: enabled });
  assert.equal((await subject.api.signInWithEmail('learner@example.invalid', 'a-valid-existing-password')).user.id, 'existing-uid');
  assert.deepEqual(names(subject), ['password-signin']);
  const collision = client({ env: enabled, fail: 'create', errorCode: 'auth/email-already-in-use' });
  await assert.rejects(collision.api.createEmailAccount('learner@example.invalid', 'new-password-123'), { code: 'auth/email-already-in-use' });
  assert.ok(collision.api.authErrorMessage(error('auth/email-already-in-use')).includes('Google'));
  assert.ok(!names(collision).includes('link'));
});

test('Google flow is preserved independently of the disabled email provider', async () => {
  const subject = client();
  const result = await subject.api.signInWithGoogle();
  assert.equal(result.user.id, 'existing-uid');
  assert.equal(result.user.email_verified, true);
  assert.deepEqual(result.user.providers, ['google.com']);
  assert.deepEqual(subject.calls[0].detail, { prompt: 'select_account' });
});

test('refresh uses server state and force-refreshes token claims before returning', async () => {
  const subject = client({ user: user(), verifyOnReload: true });
  const result = await subject.api.refreshSession();
  assert.equal(result.user.email_verified, true);
  assert.deepEqual(names(subject), ['reload', 'token']);
  assert.deepEqual(subject.calls[1].detail, { uid: 'existing-uid', force: true });
  const unverified = client({ user: user() });
  assert.equal((await unverified.api.refreshSession()).user.email_verified, false);
});

test('billing token requires the displayed account, refreshed verification and a forced token refresh without messages', async () => {
  const expectedToken = 'synthetic-firebase-token-for-unit-tests';
  const subject = client({ user: user(), verifyOnReload: true, idToken: expectedToken });
  assert.equal(await subject.api.getFreshVerifiedIdToken('existing-uid'), expectedToken);
  assert.deepEqual(names(subject), ['reload', 'token']);
  assert.equal(subject.calls[1].detail.force, true);
  const missing = client();
  await assert.rejects(missing.api.getFreshVerifiedIdToken('existing-uid'), { code: 'app/sign-in-required' });
  const wrong = client({ user: user() });
  await assert.rejects(wrong.api.getFreshVerifiedIdToken('other-uid'), { code: 'app/account-changed' });
  assert.deepEqual(names(wrong), []);
  const unverified = client({ user: user() });
  await assert.rejects(unverified.api.getFreshVerifiedIdToken('existing-uid'), { code: 'app/verification-required' });
  assert.deepEqual(names(unverified), ['reload']);
});

test('billing token is discarded if the account switches during reload or token refresh', async () => {
  for (const switchPoint of ['switchOnReload', 'switchOnToken']) {
    const subject = client({ user: user({ emailVerified: true }), idToken: 'synthetic-firebase-token-for-unit-tests', [switchPoint]: user({ uid: 'other-uid', emailVerified: true }) });
    await assert.rejects(subject.api.getFreshVerifiedIdToken('existing-uid'), { code: 'app/account-changed' });
    assert.ok(!names(subject).some(name => name.startsWith('send-')));
  }
  const invalid = client({ user: user({ emailVerified: true }) });
  await assert.rejects(invalid.api.getFreshVerifiedIdToken('existing-uid'), { code: 'app/auth-unavailable' });
});

test('account switching during refresh or password validation prevents a stale link', async () => {
  const changed = user({ uid: 'different-uid', emailVerified: true });
  const refreshing = client({ user: user(), switchOnReload: changed });
  await assert.rejects(refreshing.api.refreshSession(), { code: 'app/account-changed' });
  assert.ok(!names(refreshing).includes('token'));
  const linking = client({ env: enabled, user: user({ emailVerified: true, providerData: [{ providerId: 'google.com' }] }), switchOnPolicy: changed });
  await assert.rejects(linking.api.addPasswordToCurrentAccount('new-password-123'), { code: 'app/account-changed' });
  assert.ok(!names(linking).includes('link'));
});

test('adding a password links the same verified UID and fixed current email', async () => {
  const subject = client({ env: enabled, user: user({ emailVerified: true, providerData: [{ providerId: 'google.com' }] }) });
  const result = await subject.api.addPasswordToCurrentAccount('new-password-123');
  assert.equal(result.user.id, 'existing-uid');
  assert.deepEqual(result.user.providers, ['google.com', 'password']);
  assert.deepEqual(subject.calls.find(call => call.name === 'link').detail, { uid: 'existing-uid', email: 'learner@example.invalid' });
  assert.ok(!names(subject).some(name => name === 'create' || name.startsWith('send-')));
});

test('unverified users, existing passwords and signed-in account creation fail safely', async () => {
  const unverified = client({ env: enabled, user: user() });
  await assert.rejects(unverified.api.addPasswordToCurrentAccount('new-password-123'), { code: 'app/verification-required' });
  const linked = client({ env: enabled, user: user({ emailVerified: true }) });
  await assert.rejects(linked.api.addPasswordToCurrentAccount('new-password-123'), { code: 'auth/provider-already-linked' });
  await assert.rejects(linked.api.createEmailAccount('other@example.invalid', 'new-password-123'), { code: 'app/already-signed-in' });
  assert.ok(!names(unverified).includes('link'));
  assert.ok(!names(linked).includes('create'));
});

test('verification requests require a user and check current server verification first', async () => {
  const anonymous = client({ env: enabled });
  await assert.rejects(anonymous.api.requestVerificationEmail(), { code: 'app/sign-in-required' });
  const verified = client({ env: enabled, user: user(), verifyOnReload: true });
  assert.equal(await verified.api.requestVerificationEmail(), 'already-verified');
  assert.ok(!names(verified).includes('send-verification'));
  const subject = client({ env: enabled, user: user() });
  assert.equal(await subject.api.requestVerificationEmail(), 'requested');
  assert.equal(subject.auth.languageCode, 'en');
  assert.equal(subject.calls.at(-1).detail.settings.url, 'https://preview.example.invalid/account');
});

test('reset responses do not disclose a missing user and do not swallow other failures', async () => {
  const missing = client({ env: enabled, fail: 'send-reset', errorCode: 'auth/user-not-found' });
  await missing.api.requestPasswordReset(' LEARNER@example.invalid ');
  assert.equal(missing.calls[0].detail.email, 'learner@example.invalid');
  const offline = client({ env: enabled, fail: 'send-reset' });
  await assert.rejects(offline.api.requestPasswordReset('learner@example.invalid'), { code: 'auth/network-request-failed' });
});

test('action parsing never accepts a different project or navigates through continueUrl', () => {
  const subject = client();
  const parsed = subject.api.parseEmailAction('?mode=verifyEmail&oobCode=valid-code-123&apiKey=test-api-key&continueUrl=https://untrusted.invalid');
  assert.deepEqual(parsed, { mode: 'verifyEmail', code: 'valid-code-123' });
  for (const query of ['?mode=verifyEmail&oobCode=valid-code-123&apiKey=other-project', '?mode=verifyEmail&oobCode=valid-code-123&oobCode=other-code-123', '?mode=recoverEmail&oobCode=valid-code-123', '?mode=resetPassword&oobCode=short', '?mode=verifyEmail&mode=resetPassword&oobCode=valid-code-123']) assert.throws(() => subject.api.parseEmailAction(query), { code: 'auth/invalid-action-code' });
});

test('verification checks action type, applies a real code and refreshes without sending', async () => {
  const wrong = client({ operation: 'PASSWORD_RESET' });
  await assert.rejects(wrong.api.completeEmailVerification('valid-code-123'), { code: 'auth/invalid-action-code' });
  assert.ok(!names(wrong).includes('apply-code'));
  const subject = client({ user: user(), verifyOnReload: true });
  const result = await subject.api.completeEmailVerification('valid-code-123');
  assert.equal(result.session.user.email_verified, true);
  assert.deepEqual(names(subject), ['check-code', 'apply-code', 'reload', 'token']);
  const stale = client({ user: user(), fail: 'token' });
  assert.deepEqual(await stale.api.completeEmailVerification('valid-code-123'), { session: null, refreshed: false });
});

test('password reset checks its code and password policy before confirmation, never sending', async () => {
  const subject = client();
  await subject.api.completePasswordReset('valid-code-123', 'new-password-123');
  assert.deepEqual(names(subject), ['check-reset', 'password-policy', 'confirm-reset']);
  const invalid = client({ fail: 'check-reset', errorCode: 'auth/expired-action-code' });
  await assert.rejects(invalid.api.completePasswordReset('valid-code-123', 'new-password-123'));
  assert.ok(!names(invalid).includes('confirm-reset'));
  const weak = client();
  await assert.rejects(weak.api.completePasswordReset('valid-code-123', 'short'), { code: 'app/password-policy' });
  assert.ok(!names(weak).includes('confirm-reset'));
});
