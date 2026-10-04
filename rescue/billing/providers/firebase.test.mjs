import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SignJWT, importPKCS8, jwtVerify, importSPKI } from 'jose';
import { createFirebaseAdapter, createSandboxFirebaseAdapter } from './firebase.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minimalpairs-firebase-fixture-'));
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const keyPath = path.join(directory, 'fixture-key.pem');
fs.writeFileSync(keyPath, keyPair.privateKey, { mode: 0o600 });
const certificate = execFileSync('openssl', ['req', '-new', '-x509', '-key', keyPath, '-days', '1', '-subj', '/CN=synthetic.invalid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
fs.rmSync(directory, { recursive: true, force: true });
const signer = await importPKCS8(createPrivateKey(keyPair.privateKey).export({ format: 'pem', type: 'pkcs8' }).toString(), 'RS256');
const publicKey = await importSPKI(keyPair.publicKey, 'RS256');
const NOW = 1_800_000_000;
const uid = 'fixture_uid';
const email = 'fixture+paid@example.invalid';
const environment = (project = 'minimalpairs') => ({ FIREBASE_PROJECT_ID: project, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', project_id: project, client_email: `billing-fixture@${project}.iam.gserviceaccount.com`, private_key: keyPair.privateKey }) });
const payload = () => ({ sub: uid, aud: 'minimalpairs', iss: 'https://securetoken.google.com/minimalpairs', iat: NOW - 20, exp: NOW + 3580, auth_time: NOW - 30, email, email_verified: true });
const token = (overrides = {}, headers = {}) => new SignJWT({ ...payload(), ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'fixtureKey', ...headers }).sign(signer);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const name = (collection, id, project = 'minimalpairs') => `projects/${project}/databases/(default)/documents/${collection}/${id}`;
const document = (collection, id, fields, project = 'minimalpairs') => ({ name: name(collection, id, project), fields, updateTime: '2026-09-28T10:00:00.000001Z' });
const projection = () => ({ schemaVersion: 1, active: true, plan: 'monthly', currentPeriodEnd: NOW + 3600, updatedAt: NOW, status: 'active', reason: 'paid_period', customerId: 'cus_fixture', subscriptionId: 'sub_fixture' });

function fixture(project = 'minimalpairs') {
  const state = { calls: [], time: NOW * 1000, account: { localId: uid, email, emailVerified: true, validSince: '0' }, documents: new Map(), conflict: false, failure: null };
  const fetchImpl = async (input, init) => {
    const url = new URL(input); state.calls.push({ url, init });
    if (state.failure?.host === url.hostname) return json({ error: { message: 'sensitive provider body must not leak' } }, state.failure.status);
    if (url.hostname === 'www.googleapis.com') return json({ fixtureKey: certificate }, 200, { 'Cache-Control': 'public,max-age=3600', Age: '0' });
    if (url.hostname === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(init.body);
      const verified = await jwtVerify(form.get('assertion'), publicKey, { issuer: `billing-fixture@${project}.iam.gserviceaccount.com`, audience: 'https://oauth2.googleapis.com/token', currentDate: new Date(state.time) });
      assert.equal(verified.payload.scope, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit');
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      return json({ access_token: 'fixture-google-access-token-not-real', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer fixture-google-access-token-not-real');
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      assert.equal(url.pathname, `/v1/projects/${project}/accounts:lookup`);
      assert.deepEqual(JSON.parse(init.body), { localId: [uid] });
      return json({ users: state.account ? [state.account] : [] });
    }
    if (url.hostname === 'firestore.googleapis.com') {
      const committing = url.pathname.endsWith('/documents:commit');
      const write = committing ? JSON.parse(init.body).writes[0] : null;
      const resource = committing ? write.update.name : decodeURIComponent(url.pathname.slice(4));
      if (!committing) return state.documents.has(resource) ? json(state.documents.get(resource)) : json({}, 404);
      assert.equal(JSON.parse(init.body).writes.length, 1);
      if (state.conflict) {
        state.conflict = false;
        state.documents.set(resource, document('entitlements', uid, { adminBlocked: { booleanValue: true }, note: { stringValue: 'Keep this admin note' } }));
        return json({}, 409);
      }
      const existing = state.documents.get(resource);
      assert.deepEqual(write.currentDocument, existing ? { updateTime: existing.updateTime } : { exists: false });
      const fields = write.update.fields;
      assert.deepEqual(write.updateMask.fieldPaths.sort(), Object.keys(fields).sort());
      assert.equal(own(fields, 'adminBlocked'), false);
      const next = { name: resource, fields: { ...existing?.fields, ...fields }, updateTime: '2026-09-28T10:00:00.000002Z' };
      state.documents.set(resource, next); return json({ writeResults: [{ updateTime: next.updateTime }], commitTime: next.updateTime });
    }
    throw new Error('Unexpected endpoint');
  };
  const factory = project === 'minimalpairs' ? createFirebaseAdapter : createSandboxFirebaseAdapter;
  const adapter = factory(environment(project), { expectedLivemode: project === 'minimalpairs', fetchImpl, now: () => state.time });
  return { state, adapter, fetchImpl };
}
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

test('configuration cannot redirect credentials to another project or token issuer', () => {
  for (const env of [{}, { ...environment(), FIREBASE_PROJECT_ID: 'another-project' }, { ...environment(), FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'authorized_user' }) }]) assert.throws(() => createFirebaseAdapter(env, { expectedLivemode: true }), /firebase_not_configured/);
});

test('Sandbox factory is pinned separately and refuses production credentials or mode drift', () => {
  const sandbox = 'minimalpairs-billing-sandbox';
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('No provider call is permitted'); };
  for (const expectedLivemode of [true, undefined, 'false', 0]) {
    assert.throws(() => createSandboxFirebaseAdapter(environment(sandbox), { expectedLivemode, fetchImpl }), /firebase_not_configured/);
  }
  for (const env of [environment(), environment('another-project'),
    { ...environment(sandbox), FIREBASE_SERVICE_ACCOUNT_JSON: environment().FIREBASE_SERVICE_ACCOUNT_JSON },
    { ...environment(), FIREBASE_SERVICE_ACCOUNT_JSON: environment(sandbox).FIREBASE_SERVICE_ACCOUNT_JSON }]) {
    assert.throws(() => createSandboxFirebaseAdapter(env, { expectedLivemode: false, fetchImpl }), /firebase_not_configured/);
  }
  assert.throws(() => createFirebaseAdapter(environment(sandbox), { expectedLivemode: true, fetchImpl }), /firebase_not_configured/);
  assert.throws(() => createFirebaseAdapter(environment(sandbox), { expectedLivemode: false, fetchImpl }), /firebase_not_configured/);
  assert.equal(calls, 0);
});

test('Sandbox account lookup, legacy reads and conditional projections use only the isolated project', async () => {
  const sandbox = 'minimalpairs-billing-sandbox';
  const f = fixture(sandbox);
  const idToken = await token({ aud: sandbox, iss: `https://securetoken.google.com/${sandbox}` });
  assert.deepEqual(await f.adapter.auth.verifyIdToken(idToken), { uid, email, emailVerified: true, serverVerified: true });
  const fields = { active: { booleanValue: true }, plan: { stringValue: 'lifetime' } };
  f.state.documents.set(name('legacyEntitlements', email), document('legacyEntitlements', email, fields));
  assert.equal(await f.adapter.legacyEntitlement(email), null, 'Production lifetime grant must not be visible in Sandbox');
  f.state.documents.set(name('legacyEntitlements', email, sandbox), document('legacyEntitlements', email, fields, sandbox));
  assert.deepEqual(await f.adapter.legacyEntitlement(email), { active: true, plan: 'lifetime' });
  await f.adapter.entitlements.projectSubscription(uid, projection());
  assert.equal(f.state.documents.has(name('entitlements', uid)), false);
  assert.equal(f.state.documents.get(name('entitlements', uid, sandbox)).fields.active.booleanValue, true);
  for (const { url, init } of f.state.calls.filter(c => ['identitytoolkit.googleapis.com', 'firestore.googleapis.com'].includes(c.url.hostname))) {
    assert.ok(url.pathname.startsWith(`/v1/projects/${sandbox}/`));
    assert.equal(String(init.body || '').includes('projects/minimalpairs/'), false);
  }
});

test('production and Sandbox reject each other’s otherwise valid signed identity tokens', async () => {
  const sandbox = 'minimalpairs-billing-sandbox';
  for (const [destination, tokenProject] of [[sandbox, 'minimalpairs'], ['minimalpairs', sandbox]]) {
    const f = fixture(destination);
    await assert.rejects(f.adapter.auth.verifyIdToken(await token({ aud: tokenProject, iss: `https://securetoken.google.com/${tokenProject}` })), /firebase_identity_unavailable/);
    assert.equal(f.state.calls.some(c => ['identitytoolkit.googleapis.com', 'firestore.googleapis.com', 'oauth2.googleapis.com'].includes(c.url.hostname)), false);
  }
});

test('real RSA signature plus current Google account is required; current account is not cached', async () => {
  const f = fixture(); const idToken = await token();
  assert.deepEqual(await f.adapter.auth.verifyIdToken(idToken), { uid, email, emailVerified: true, serverVerified: true });
  f.state.account.disabled = true;
  await assert.rejects(f.adapter.auth.verifyIdToken(idToken), /firebase_identity_unavailable/);
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'www.googleapis.com').length, 1);
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'oauth2.googleapis.com').length, 1);
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'identitytoolkit.googleapis.com').length, 2);
});

test('wrong signature, audience, issuer, time, tenant and unverified claims never reach account lookup', async () => {
  const altered = [
    { aud: 'other-project' }, { aud: ['minimalpairs', 'other-project'] }, { iss: 'https://example.invalid' },
    { exp: NOW }, { iat: NOW + 1 }, { auth_time: NOW + 1 }, { auth_time: -1 }, { email_verified: false },
    { firebase: { tenant: 'unexpected' } }, { sub: '../other' }, { email: 'invalid' }, { exp: undefined },
  ];
  for (const claims of altered) {
    const f = fixture(); await assert.rejects(f.adapter.auth.verifyIdToken(await token(claims)), /firebase_identity_unavailable/);
    assert.equal(f.state.calls.some(c => c.url.hostname === 'identitytoolkit.googleapis.com'), false);
  }
  const f = fixture(), valid = await token();
  const parts = valid.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...payload(), email: 'forged@example.invalid' })).toString('base64url');
  await assert.rejects(f.adapter.auth.verifyIdToken(parts.join('.')), /firebase_identity_unavailable/);
  await assert.rejects(f.adapter.auth.verifyIdToken(await token({}, { jku: 'https://attacker.invalid/keys' })), /firebase_identity_unavailable/);
  assert.equal(f.state.calls.some(c => c.url.hostname === 'identitytoolkit.googleapis.com'), false);
});

test('unknown key does not defeat cache lifetime, and key/token caches refresh when expired', async () => {
  const f = fixture(); await f.adapter.auth.verifyIdToken(await token());
  for (let i = 0; i < 3; i++) await assert.rejects(f.adapter.auth.verifyIdToken(await token({}, { kid: `unknown${i}` })));
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'www.googleapis.com').length, 1);
  f.state.time += 3601000;
  await f.adapter.auth.verifyIdToken(await token({ iat: NOW + 3580, exp: NOW + 7180 }));
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'www.googleapis.com').length, 2);
  assert.equal(f.state.calls.filter(c => c.url.hostname === 'oauth2.googleapis.com').length, 2);
});

test('deleted, disabled, revoked, moved or unverified current accounts fail closed', async () => {
  for (const account of [null, { disabled: true }, { validSince: String(NOW - 29) }, { emailVerified: false }, { localId: 'other' }, { email: 'changed@example.invalid' }, { tenantId: 'unexpected' }, { disabled: 'false' }, { validSince: 'broken' }]) {
    const f = fixture(); f.state.account = account === null ? null : { ...f.state.account, ...account };
    await assert.rejects(f.adapter.auth.verifyIdToken(await token()), /firebase_identity_unavailable/);
  }
});

test('provider failure never exposes response bodies or silently accepts identity', async () => {
  const f = fixture(); f.state.failure = { host: 'identitytoolkit.googleapis.com', status: 403 };
  await assert.rejects(f.adapter.auth.verifyIdToken(await token()), error => error.message === 'firebase_identity_unavailable');
});

test('legacy lookup is exact normalized email, preserves aliases, and never writes', async () => {
  const f = fixture(); f.state.documents.set(name('legacyEntitlements', email), document('legacyEntitlements', email, { active: { booleanValue: true }, plan: { stringValue: 'lifetime' } }));
  assert.deepEqual(await f.adapter.legacyEntitlement(` ${email.toUpperCase()} `), { active: true, plan: 'lifetime' });
  assert.equal(await f.adapter.legacyEntitlement('fixture@example.invalid'), null);
  assert.equal(f.state.calls.some(c => c.url.pathname.endsWith('/documents:commit')), false);
  const requested = f.state.calls.find(c => c.url.hostname === 'firestore.googleapis.com').url.href;
  assert.match(requested, /fixture%2Bpaid%40example.invalid$/);
  await assert.rejects(f.adapter.legacyEntitlement('a/b@example.invalid'), /firebase_invalid_email/);
  f.state.failure = { host: 'firestore.googleapis.com', status: 403 };
  await assert.rejects(f.adapter.legacyEntitlement(email), error => error.message === 'firebase_request_failed');
});

test('new subscription write requires absence and uses only the scoped UID document and field mask', async () => {
  const f = fixture(); await f.adapter.entitlements.projectSubscription(uid, projection());
  const result = f.state.documents.get(name('entitlements', uid));
  assert.equal(result.fields.active.booleanValue, true);
  assert.equal(result.fields.currentPeriodEnd.integerValue, String(NOW + 3600));
  assert.equal(f.state.calls.filter(c => c.url.pathname.endsWith('/documents:commit')).length, 1);
  assert.equal(f.state.calls.some(c => c.url.pathname.includes('legacyEntitlements')), false);
  await assert.rejects(f.adapter.entitlements.projectSubscription('other/uid', projection()), /firebase_invalid_uid/);
});

test('existing admin block and unrelated fields survive canonical paid projection', async () => {
  const f = fixture(); f.state.documents.set(name('entitlements', uid), document('entitlements', uid, { adminBlocked: { booleanValue: true }, note: { stringValue: 'preserve' } }));
  assert.deepEqual(await f.adapter.entitlements.projectSubscription(uid, projection()), { written: true, adminBlocked: true });
  const fields = f.state.documents.get(name('entitlements', uid)).fields;
  assert.equal(fields.active.booleanValue, false); assert.equal(fields.adminBlocked.booleanValue, true);
  assert.equal(fields.reason.stringValue, 'admin_blocked'); assert.equal(fields.note.stringValue, 'preserve');
});

test('a concurrent administrator block wins after a failed write precondition', async () => {
  const f = fixture(); f.state.conflict = true;
  await f.adapter.entitlements.projectSubscription(uid, projection());
  assert.equal(f.state.calls.filter(c => c.url.pathname.endsWith('/documents:commit')).length, 2);
  assert.equal(f.state.documents.get(name('entitlements', uid)).fields.active.booleanValue, false);
});

test('newer projection, legacy-shaped UID grant and malformed manual block are never overwritten', async () => {
  for (const fields of [{ updatedAt: { integerValue: String(NOW + 1) } }, { plan: { stringValue: 'lifetime' } }, { adminBlocked: { stringValue: 'true' } }]) {
    const f = fixture(); f.state.documents.set(name('entitlements', uid), document('entitlements', uid, fields));
    await assert.rejects(f.adapter.entitlements.projectSubscription(uid, projection()));
    assert.equal(f.state.calls.some(c => c.url.pathname.endsWith('/documents:commit')), false);
  }
});

test('failed identity/projection shapes cannot become active grants', async () => {
  const f = fixture();
  for (const changes of [{ active: 'true' }, { plan: 'lifetime' }, { currentPeriodEnd: NOW - 1 }, { updatedAt: NaN }, { reason: 'unknown' }, { customerId: undefined }, { status: 'arbitrary unsafe value' }]) {
    await assert.rejects(f.adapter.entitlements.projectSubscription(uid, { ...projection(), ...changes }), /firebase_invalid_projection/);
  }
  assert.equal(f.state.calls.length, 0);
});

test('inactive projection explicitly clears old provider identifiers without touching unrelated fields', async () => {
  const f = fixture(); f.state.documents.set(name('entitlements', uid), document('entitlements', uid, { customerId: { stringValue: 'cus_old' }, note: { stringValue: 'keep' } }));
  await f.adapter.entitlements.projectSubscription(uid, { schemaVersion: 1, active: false, plan: null, currentPeriodEnd: 0, updatedAt: NOW, status: 'unavailable', reason: 'unverified_snapshot' });
  const fields = f.state.documents.get(name('entitlements', uid)).fields;
  assert.deepEqual(fields.customerId, { nullValue: null }); assert.equal(fields.note.stringValue, 'keep');
});

test('a transport timeout fails rather than falling back to unverified access', async () => {
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true, timeoutMs: 10, now: () => NOW * 1000, fetchImpl: async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(adapter.auth.verifyIdToken(await token()), /firebase_identity_unavailable/);
});

test('production Firebase factory refuses Sandbox or unspecified billing mode before any request', () => {
  let calls = 0;
  for (const expectedLivemode of [false, undefined, 'true']) {
    assert.throws(() => createFirebaseAdapter(environment(), { expectedLivemode, fetchImpl: () => { calls++; } }), /firebase_not_configured/);
  }
  assert.equal(calls, 0);
});

test('expired or already cancelled workflow cannot start a provider request', async () => {
  const f = fixture(); const controller = new AbortController();
  let context = { signal: controller.signal, deadline: f.state.time };
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true, fetchImpl: f.fetchImpl,
    now: () => f.state.time, getOperationContext: () => context });
  await assert.rejects(adapter.legacyEntitlement(email), /firebase_operation_expired/);
  context = { signal: controller.signal, deadline: f.state.time + 1000 }; controller.abort();
  await assert.rejects(adapter.entitlements.projectSubscription(uid, projection()), /firebase_operation_expired/);
  assert.equal(f.state.calls.length, 0);
});

test('shared cancellation reaches a pending OAuth fetch and prevents later database work', async () => {
  const controller = new AbortController(); let aborted = false, calls = 0;
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true,
    getOperationContext: () => ({ signal: controller.signal, deadline: Date.now() + 5000 }),
    fetchImpl: async (url, init) => {
      calls++; assert.equal(new URL(url).hostname, 'oauth2.googleapis.com');
      queueMicrotask(() => controller.abort());
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
        aborted = true; reject(new Error('fixture aborted'));
      }, { once: true }));
    } });
  await assert.rejects(adapter.legacyEntitlement(email), /firebase_request_failed/);
  assert.equal(aborted, true); assert.equal(calls, 1);
});

test('shared cancellation also stops a stalled response body before another request', async () => {
  const controller = new AbortController(); let cancelled = false, calls = 0;
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true,
    getOperationContext: () => ({ signal: controller.signal, deadline: Date.now() + 5000 }),
    fetchImpl: async () => {
      calls++;
      return new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode('{')); setTimeout(() => controller.abort(), 10); },
        cancel() { cancelled = true; },
      }));
    } });
  await assert.rejects(adapter.legacyEntitlement(email), /firebase_request_failed/);
  assert.equal(cancelled, true); assert.equal(calls, 1);
});

test('one shared deadline covers the read and write, including optimistic retries', async () => {
  const f = fixture(); const controller = new AbortController(); const deadline = f.state.time + 1000;
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true,
    now: () => f.state.time, getOperationContext: () => ({ signal: controller.signal, deadline }),
    fetchImpl: async (url, init) => {
      const response = await f.fetchImpl(url, init);
      if (new URL(url).hostname === 'firestore.googleapis.com') f.state.time = deadline;
      return response;
    } });
  await assert.rejects(adapter.entitlements.projectSubscription(uid, projection()), /firebase_operation_expired/);
  assert.equal(f.state.calls.filter(c => c.url.pathname.endsWith('/documents:commit')).length, 0);
  assert.equal(f.state.documents.size, 0);
});

for (const kind of ['OAuth', 'certificates']) test(`concurrent ${kind} cache misses retain separate workflow cancellation`, async () => {
  const f = fixture(); const first = new AbortController(), second = new AbortController();
  let shared = { signal: first.signal, deadline: f.state.time + 5000 };
  let enterFirst, enterSecond, releaseFirst, secondAborted = false, requests = 0;
  const firstEntered = new Promise(resolve => { enterFirst = resolve; });
  const secondEntered = new Promise(resolve => { enterSecond = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  const interceptedHost = kind === 'OAuth' ? 'oauth2.googleapis.com' : 'www.googleapis.com';
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true, now: () => f.state.time,
    getOperationContext: () => shared,
    fetchImpl: async (url, init) => {
      if (new URL(url).hostname === interceptedHost) {
        requests++;
        if (requests === 1) { enterFirst(); await firstRelease; }
        else if (requests === 2) {
          enterSecond();
          return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
            secondAborted = true; reject(new Error('second workflow stopped'));
          }, { once: true }));
        }
      }
      return f.fetchImpl(url, init);
    } });
  const idToken = await token();
  const invoke = () => kind === 'OAuth' ? adapter.legacyEntitlement(email) : adapter.auth.verifyIdToken(idToken);
  const a = invoke(); await firstEntered;
  shared = { signal: second.signal, deadline: f.state.time + 5000 };
  const b = invoke();
  let timer;
  try {
    await Promise.race([secondEntered, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('second workflow shared the first pending fetch')), 500); })]);
    second.abort();
    await assert.rejects(b, /firebase_(request_failed|identity_unavailable)/);
    assert.equal(secondAborted, true); assert.equal(first.signal.aborted, false);
  } finally {
    clearTimeout(timer); releaseFirst();
    await Promise.allSettled([a, b]);
  }
  const result = await a;
  assert.deepEqual(result, kind === 'OAuth' ? null : { uid, email, emailVerified: true, serverVerified: true });
});

test('missing document abandons its unused response body and aborts that transport', async () => {
  const f = fixture(); let cancelled = false, requestSignal;
  const adapter = createFirebaseAdapter(environment(), { expectedLivemode: true, now: () => f.state.time,
    fetchImpl: async (url, init) => {
      if (new URL(url).hostname === 'firestore.googleapis.com') {
        requestSignal = init.signal;
        return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 });
      }
      return f.fetchImpl(url, init);
    } });
  assert.equal(await adapter.legacyEntitlement(email), null);
  assert.equal(cancelled, true); assert.equal(requestSignal.aborted, true);
});

test('Workers-compatible manual redirect mode rejects redirected certificates without following them', async () => {
  const f = fixture();
  f.state.failure = { host: 'www.googleapis.com', status: 302 };
  await assert.rejects(f.adapter.auth.verifyIdToken(await token()), /firebase_identity_unavailable/);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].init.redirect, 'manual');
});

test('paid lifetime projection persists and a later canonical revocation removes it',async()=>{
 const f=fixture();
 const paid={schemaVersion:1,active:true,plan:'lifetime',currentPeriodEnd:0,updatedAt:NOW,status:'active',reason:'paid_lifetime',customerId:'cus_fixture',checkoutSessionId:'cs_test_fixture',paymentIntentId:'pi_fixture'};
 await f.adapter.entitlements.projectSubscription(uid,paid);
 assert.equal(f.state.documents.get(name('entitlements',uid)).fields.plan.stringValue,'lifetime');
 await f.adapter.entitlements.projectSubscription(uid,{...paid,updatedAt:NOW+1});
 assert.equal(f.state.documents.get(name('entitlements',uid)).fields.active.booleanValue,true);
 await f.adapter.entitlements.projectSubscription(uid,{schemaVersion:1,active:false,plan:null,currentPeriodEnd:0,updatedAt:NOW+2,status:'unavailable',reason:'unverified_snapshot'});
 assert.equal(f.state.documents.get(name('entitlements',uid)).fields.active.booleanValue,false);
});
