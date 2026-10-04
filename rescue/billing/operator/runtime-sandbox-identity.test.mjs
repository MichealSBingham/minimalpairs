import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeSandboxOperator, main, SANDBOX } from './runtime-sandbox-identity.mjs';
import { privateJson } from './runtime-sandbox-state.mjs';

// All credentials, HTTP responses and users in this file are synthetic. No
// fixture uses the default owner-token supplier, fetch or private directory.
const instant = 1790710000000;
const serviceId = '123456789012345678901';
const keyId = 'fixturekey123';
const keyName = `projects/${SANDBOX.project}/serviceAccounts/${serviceId}/keys/${keyId}`;
const secretKey = 'sk_test_' + 'onlyOfflineFixture12345678901234567890';
const ownerToken = 'offlineOwnerToken12345678901234567890';
const idToken = 'offlineSignedIdToken12345678901234567890';
const refreshToken = 'offlineRefreshToken12345678901234567890';
const credentials = { type: 'service_account', project_id: SANDBOX.project, client_email: SANDBOX.serviceAccount,
  client_id: serviceId, private_key_id: keyId, private_key: '-----BEGIN PRIVATE KEY-----\nOFFLINE FIXTURE\n-----END PRIVATE KEY-----' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
function fixture(t, changes = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-sandbox-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'runtime-sandbox-identity.json');
  fs.writeFileSync(path.join(directory, 'stripe-sandbox.json'), JSON.stringify({ accountId: SANDBOX.stripeAccount, livemode: false, secretKey }), { mode: 0o600 });
  const calls = []; const keys = new Map();
  const state = { billing: false, users: [], ...changes };
  const fetchImpl = async (input, init) => {
    const url = new URL(input); const body = init.body && (init.headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body)));
    calls.push({ url, method: init.method, body });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    assert.ok(['cloudbilling.googleapis.com', 'identitytoolkit.googleapis.com', 'firebase.googleapis.com', 'iam.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'api.stripe.com'].includes(url.hostname));
    if (url.hostname === 'api.stripe.com') {
      assert.equal(init.method, 'GET'); assert.equal(url.pathname, '/v1/account'); assert.equal(init.headers.Authorization, `Bearer ${secretKey}`);
      return response({ id: state.stripeId || SANDBOX.stripeAccount, object: 'account' });
    }
    if (url.pathname.endsWith('/billingInfo')) {
      assert.equal(url.pathname, `/v1/projects/${SANDBOX.project}/billingInfo`); return response({ billingEnabled: state.billing });
    }
    if (url.pathname.startsWith('/admin/')) return response({ subtype: 'FIREBASE_AUTH', signIn: { email: { enabled: true } } });
    if (url.hostname === 'firebase.googleapis.com') return response({ projectId: SANDBOX.project, appId: SANDBOX.appId, apiKey: 'offlineApiKey12345678901234567890' });
    if (url.hostname === 'iam.googleapis.com') {
      if (!url.pathname.includes('/keys')) return response({ projectId: SANDBOX.project, email: SANDBOX.serviceAccount, uniqueId: serviceId });
      if (url.pathname.endsWith('/keys') && init.method === 'GET') return response({ keys: [...keys.values()] });
      if (url.pathname.endsWith('/keys') && init.method === 'POST') {
        assert.deepEqual(body, { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' });
        keys.set(keyId, { name: keyName, keyType: 'USER_MANAGED', validAfterTime: new Date(instant).toISOString() });
        if (state.loseKeyReply) throw new Error('transport failure with a private fixture value');
        return response({ ...keys.get(keyId), privateKeyData: Buffer.from(JSON.stringify(credentials)).toString('base64') });
      }
      const id = url.pathname.split('/').at(-1); const key = keys.get(id);
      if (!key) return response({}, 404);
      if (init.method === 'DELETE') {
        if (state.failKeyDelete) return response({}, 500);
        keys.delete(id); return response({});
      }
      return response(key);
    }
    if (url.hostname === 'securetoken.googleapis.com') {
      assert.equal(body.grant_type, 'refresh_token'); assert.equal(body.refresh_token, refreshToken);
      return response({ user_id: state.users[0]?.localId, project_id: state.refreshProject || '350102033623', id_token: idToken, refresh_token: refreshToken });
    }
    if (url.hostname === 'firestore.googleapis.com') {
      assert.match(url.pathname, new RegExp(`^/v1/projects/${SANDBOX.project}/databases/\\(default\\)/documents/entitlements/runtime_[a-f0-9]{32}$`));
      if (!state.document) return response({}, 404);
      if (init.method === 'DELETE') {
        assert.equal(url.searchParams.get('currentDocument.updateTime'), state.document.updateTime);
        if (state.failDocumentDelete) return response({}, 412);
        state.document = null; return response({});
      }
      return response(state.document);
    }
    const action = url.pathname.split(':').at(-1);
    if (action === 'lookup') {
      assert.equal(body.targetProjectId, SANDBOX.project); assert.match(body.localId[0], /^runtime_[a-f0-9]{32}$/);
      if (state.preexistingUser && !state.users.length) state.users = [{ localId: body.localId[0], email: `${body.localId[0]}@example.invalid`, emailVerified: true }];
      return response({ users: state.users.filter(user => body.localId.includes(user.localId)) });
    }
    if (action === 'signUp') {
      assert.equal(init.headers.Authorization, `Bearer ${ownerToken}`); assert.equal(body.targetProjectId, SANDBOX.project);
      assert.match(body.localId, /^runtime_[a-f0-9]{32}$/); assert.equal(body.email, `${body.localId}@example.invalid`); assert.equal(body.emailVerified, true);
      state.users.push({ localId: body.localId, email: body.email, emailVerified: true });
      if (state.loseSignUpReply) throw new Error('transport interrupted');
      return response({ localId: body.localId });
    }
    if (action === 'signInWithPassword') {
      assert.equal(body.email, state.users[0].email); assert.equal(init.headers.Authorization, undefined);
      return response({ localId: state.users[0].localId, idToken, refreshToken });
    }
    if (action === 'update') {
      assert.equal(body.targetProjectId, SANDBOX.project); assert.equal(body.localId, state.users[0].localId); assert.equal(body.disableUser, true);
      state.users[0].disabled = true; return response({});
    }
    if (action === 'delete') {
      assert.equal(body.targetProjectId, SANDBOX.project); assert.equal(body.localId, state.users[0].localId);
      if (state.failUserDelete) return response({}, 500);
      state.users = []; return response({});
    }
    throw new Error('Unexpected fixture route');
  };
  const options = { privateDir: directory, fetchImpl, getOwnerToken: async () => ownerToken, now: () => instant,
    verifyIdentity: async (token, key) => {
      assert.equal(token, idToken); assert.deepEqual(key, credentials);
      if (state.failVerification) throw new Error('private provider error');
      return { uid: state.users[0]?.localId, email: state.users[0]?.email, emailVerified: true, serverVerified: true };
    } };
  const op = createRuntimeSandboxOperator(options);
  const read = () => privateJson(file);
  const count = (method, suffix) => calls.filter(call => call.method === method && call.url.pathname.endsWith(suffix)).length;
  return { op, read, state, keys, calls, count, file, directory, options };
}

test('default invocation is inert and status discloses no credentials', async t => {
  assert.equal((await main([])).action, 'none');
  const f = fixture(t); assert.equal((await f.op.status()).prepared, false); assert.equal(f.calls.length, 0);
});

test('prepare and refresh verify the fixed identity and export secrets only in process', async t => {
  const f = fixture(t); const result = await f.op.prepare();
  assert.equal(result.prepared, true); assert.ok(!JSON.stringify(result).includes(secretKey));
  const original = f.read(); const current = await f.op.refresh();
  assert.equal(current.uid, original.uid); assert.equal(current.idToken, idToken); assert.deepEqual(current.serviceCredentials, credentials);
  assert.equal(current.stripeSecretKey, secretKey); assert.equal(current.projectId, SANDBOX.project); assert.equal(current.stripeAccountId, SANDBOX.stripeAccount);
  assert.equal(f.count('POST', '/keys'), 1); assert.equal(f.count('POST', ':signUp'), 1);
  assert.equal(f.count('GET', '/v1/account'), 3); assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700); assert.equal(f.read().runId, original.runId);
  assert.ok(f.calls.every(call => !/sendOobCode|sendVerificationCode|resetPassword/.test(call.url.href)));
});

test('a failed first verification resumes the same key and user without duplicate creation', async t => {
  const f = fixture(t, { failVerification: true });
  await assert.rejects(f.op.prepare(), /^Error: sandbox_operation_failed$/);
  const original = f.read(); f.state.failVerification = false;
  assert.equal((await createRuntimeSandboxOperator(f.options).prepare()).prepared, true);
  assert.equal(f.read().uid, original.uid); assert.equal(f.count('POST', '/keys'), 1); assert.equal(f.count('POST', ':signUp'), 1);
});

test('lost key response cannot repeat creation and requires explicit scoped cleanup recovery', async t => {
  const f = fixture(t, { loseKeyReply: true });
  await assert.rejects(f.op.prepare(), /sandbox_operation_failed/);
  assert.equal((await f.op.status()).keyCreationUncertain, true);
  await assert.rejects(f.op.prepare(), /sandbox_key_creation_uncertain/); assert.equal(f.count('POST', '/keys'), 1);
  await assert.rejects(f.op.cleanup({ runtimeStopped: true }), /sandbox_cleanup_incomplete/); assert.equal(f.keys.size, 1);
  await f.op.adoptKeyForCleanup(keyId);
  assert.equal((await f.op.cleanup({ runtimeStopped: true })).cleanupComplete, true); assert.equal(f.keys.size, 0);
  await assert.rejects(f.op.prepare(), /sandbox_identity_unavailable/);
});

test('uncertain key recovery rejects foreign and later unrelated keys', async t => {
  const f = fixture(t, { loseKeyReply: true }); await assert.rejects(f.op.prepare());
  const key = f.keys.get(keyId);
  key.validAfterTime = new Date(instant + 3600000).toISOString();
  await assert.rejects(f.op.adoptKeyForCleanup(keyId), /sandbox_key_scope_invalid/);
  key.validAfterTime = new Date(instant).toISOString(); key.name = keyName.replace(SANDBOX.project, 'minimalpairs');
  await assert.rejects(f.op.adoptKeyForCleanup(keyId), /sandbox_key_scope_invalid/);
  assert.equal(f.count('DELETE', `/keys/${keyId}`), 0); assert.equal(f.read().key.name, undefined);
});

test('lost user creation reply recovers by exact lookup without repeating signup', async t => {
  const f = fixture(t, { loseSignUpReply: true }); await assert.rejects(f.op.prepare());
  assert.equal(f.read().identity.created, undefined);
  assert.equal((await f.op.prepare()).prepared, true); assert.equal(f.count('POST', ':signUp'), 1);
});

test('failed user preflight grants no authority to delete that user or its document', async t => {
  const f = fixture(t, { preexistingUser: true }); await assert.rejects(f.op.prepare(), /sandbox_preexisting_user/);
  assert.equal((await f.op.cleanup({ runtimeStopped: true })).cleanupComplete, true);
  assert.equal(f.state.users.length, 1); assert.equal(f.count('POST', ':delete'), 0);
  assert.equal(f.calls.filter(call => call.url.hostname === 'firestore.googleapis.com').length, 0);
});

test('paid Firebase project or wrong Stripe account cannot create a key or user', async t => {
  for (const changes of [{ billing: true }, { stripeId: 'acct_foreign' }]) {
    const f = fixture(t, changes); await assert.rejects(f.op.prepare(), /sandbox_(billing_must_be_disabled|stripe_account_mismatch)/);
    assert.equal(f.count('POST', '/keys'), 0); assert.equal(f.count('POST', ':signUp'), 0);
  }
});

test('refresh checks current account state, token project and actual Stripe account', async t => {
  const f = fixture(t); await f.op.prepare();
  f.state.refreshProject = 'different'; await assert.rejects(f.op.refresh(), /sandbox_identity_mismatch/);
  delete f.state.refreshProject; f.state.stripeId = 'acct_foreign'; await assert.rejects(f.op.refresh(), /sandbox_stripe_account_mismatch/);
  delete f.state.stripeId; f.state.users[0].disabled = true; await assert.rejects(f.op.refresh(), /sandbox_identity_unavailable/);
});

test('disable and delete are exact, confirmed and irreversible for this checkpoint', async t => {
  const f = fixture(t); await f.op.prepare();
  assert.equal((await f.op.disableUser()).userDisabled, true); assert.equal(f.read().password, undefined); assert.equal(f.read().refreshToken, undefined);
  await f.op.disableUser(); assert.equal(f.count('POST', ':update'), 1);
  await assert.rejects(f.op.refresh(), /sandbox_identity_unavailable/);
  assert.equal((await f.op.deleteUser()).userDeleted, true); await f.op.deleteUser(); assert.equal(f.count('POST', ':delete'), 1);
});

test('cleanup requires stopped runtime and retries only failed scoped removals', async t => {
  const f = fixture(t); await f.op.prepare(); const uid = f.read().uid;
  f.state.document = { name: `projects/${SANDBOX.project}/databases/(default)/documents/entitlements/${uid}`, updateTime: '2026-09-29T12:00:00Z' };
  const count = f.calls.length; await assert.rejects(f.op.cleanup(), /sandbox_stop_runtime_first/); assert.equal(f.calls.length, count);
  f.state.failUserDelete = true; await assert.rejects(f.op.cleanup({ runtimeStopped: true }), /sandbox_cleanup_incomplete/);
  assert.equal(f.keys.size, 0); assert.equal(f.state.document, null); assert.equal(f.read().key.credentials, undefined);
  assert.equal(f.read().cleanupComplete, false);
  f.state.failUserDelete = false; assert.equal((await f.op.cleanup({ runtimeStopped: true })).cleanupComplete, true);
  assert.equal(f.state.users.length, 0); assert.equal(f.count('DELETE', `/keys/${keyId}`), 1);
});

test('concurrent document changes prevent deletion while other cleanup continues', async t => {
  const f = fixture(t); await f.op.prepare(); const uid = f.read().uid;
  f.state.document = { name: `projects/${SANDBOX.project}/databases/(default)/documents/entitlements/${uid}`, updateTime: '2026-09-29T12:00:00Z' };
  f.state.failDocumentDelete = true; await assert.rejects(f.op.cleanup({ runtimeStopped: true }), /sandbox_cleanup_incomplete/);
  assert.ok(f.state.document); assert.equal(f.keys.size, 0); assert.equal(f.state.users.length, 0);
  f.state.failDocumentDelete = false; assert.equal((await f.op.cleanup({ runtimeStopped: true })).cleanupComplete, true);
});

test('malformed or foreign checkpoint is rejected before OAuth or HTTP', async t => {
  const f = fixture(t); await f.op.prepare(); const state = f.read(); const count = f.calls.length;
  state.project = 'minimalpairs'; fs.writeFileSync(f.file, JSON.stringify(state));
  await assert.rejects(f.op.refresh(), /sandbox_checkpoint_invalid/); await assert.rejects(f.op.cleanup({ runtimeStopped: true }), /sandbox_checkpoint_invalid/);
  assert.equal(f.calls.length, count);
});
