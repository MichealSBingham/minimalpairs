import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, getIdTokenResult, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import * as firebaseFirestore from 'firebase/firestore';

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = 'demo-minimalpairs-auth';
test('local Firebase verification/reset retain identity; unsupported emulator linking fails safely', { skip: !host }, async () => {
  assert.equal(host, '127.0.0.1:9098', 'This test must never connect to a remote Auth service');
  assert.ok(projectId.startsWith('demo-'));
  const config = { apiKey: 'demo-auth-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: 'demo-auth-app' };
  const app = initializeApp(config, 'local-email-auth-test');
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
  assert.equal(auth.emulatorConfig?.host, '127.0.0.1');
  const env = { PUBLIC_FIREBASE_API_KEY: config.apiKey, PUBLIC_FIREBASE_AUTH_DOMAIN: config.authDomain, PUBLIC_FIREBASE_PROJECT_ID: projectId, PUBLIC_FIREBASE_APP_ID: config.appId, PUBLIC_EMAIL_PASSWORD_ENABLED: 'true', PUBLIC_AUTH_EMAILS_ENABLED: 'true' };
  const source = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', JSON.stringify(env));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // The wrapper and fixture must share the ESM SDK registry; CJS has its own app registry.
  const dependencies = { 'firebase/app': firebaseApp, 'firebase/firestore': firebaseFirestore, 'firebase/auth': { ...firebaseAuth,
    // Auth Emulator does not implement getPasswordPolicy. Its response handling
    // and rejection paths are covered in auth-email.test.mjs; no production bypass.
    validatePassword: async (current, password) => {
      assert.equal(current.emulatorConfig?.host, '127.0.0.1');
      return { isValid: password.length >= 12 };
    }, getAuth: configured => {
    const current = getAuth(configured);
    assert.equal(current.emulatorConfig?.host, '127.0.0.1', 'Every wrapper call must target the local emulator');
    assert.equal(current.emulatorConfig?.port, 9098);
    return current;
  } } };
  new Function('require', 'module', 'exports', 'window', compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports, { location: { origin: 'http://localhost:4341' } });
  const api = module.exports;
  const email = `email-${Date.now()}@example.invalid`;
  const codes = async () => {
    const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/oobCodes`);
    assert.equal(response.status, 200);
    return (await response.json()).oobCodes || [];
  };
  try {
    const created = await api.createEmailAccount(email, 'local-test-password-123');
    const uid = created.user.id;
    assert.equal(created.user.email_verified, false);
    assert.equal((await codes()).filter(code => code.email === email).length, 0, 'Creation must not automatically request a message');
    assert.equal(await api.requestVerificationEmail(), 'requested');
    const verify = (await codes()).find(code => code.email === email && code.requestType === 'VERIFY_EMAIL');
    assert.ok(verify?.oobCode, 'The local emulator supplies an action code instead of delivering email');
    await api.inspectEmailAction({ mode: 'verifyEmail', code: verify.oobCode });
    const verified = await api.completeEmailVerification(verify.oobCode);
    assert.equal(verified.session.user.id, uid);
    assert.equal(verified.session.user.email_verified, true);
    assert.equal((await getIdTokenResult(auth.currentUser, true)).claims.email_verified, true);
    await assert.rejects(api.completeEmailVerification(verify.oobCode), { code: 'auth/invalid-action-code' });
    await api.requestPasswordReset(email);
    const reset = (await codes()).find(code => code.email === email && code.requestType === 'PASSWORD_RESET');
    assert.ok(reset?.oobCode);
    await api.completePasswordReset(reset.oobCode, 'local-replacement-password-456');
    await api.signOut();
    assert.equal((await api.signInWithEmail(email, 'local-replacement-password-456')).user.id, uid);
    await api.signOut();
    const googleEmail = `google-${Date.now()}@example.invalid`;
    const token = JSON.stringify({ sub: `google-fixture-${Date.now()}`, email: googleEmail, email_verified: true });
    const google = await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    assert.equal(google.user.emailVerified, true);
    // The installed emulator does not implement the SDK 12 accounts:signUp
    // idToken linking flow: it rejects the existing email before examining its
    // owner. Keep the production SDK path, and prove failure cannot create a
    // replacement account or change the Google user's identity. Successful
    // linking remains a separate live-provider check, currently disabled.
    await assert.rejects(api.addPasswordToCurrentAccount('linked-google-password-789'), { code: 'auth/email-already-in-use' });
    const retained = await api.refreshSession();
    assert.equal(retained.user.id, google.user.uid);
    assert.deepEqual(retained.user.providers, ['google.com']);
    await api.signOut();
    assert.equal((await api.signInWithEmail(email, 'local-replacement-password-456')).user.id, uid);
  } finally { await deleteApp(app); }
});
