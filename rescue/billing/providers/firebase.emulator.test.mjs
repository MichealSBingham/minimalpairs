import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createFirebaseAdapter, createSandboxFirebaseAdapter } from './firebase.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-minimalpairs-billing';
for (const sourceProject of ['minimalpairs', 'minimalpairs-billing-sandbox']) test(`real Firestore REST preserves field masks and an administrative block for ${sourceProject}`, { skip: !host }, async () => {
  assert.match(host, /^(127\.0\.0\.1|localhost):8089$/);
  assert.equal(process.env.GCLOUD_PROJECT, project);
  const origin = `http://${host}`;
  const localPrefix = `projects/${project}/databases/(default)/documents`;
  const fixedPrefix = `projects/${sourceProject}/databases/(default)/documents`;
  const uid = `billing_fixture_${sourceProject}_${Date.now()}`;
  const serviceKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  const env = { FIREBASE_PROJECT_ID: sourceProject, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', project_id: sourceProject, client_email: `fixture@${sourceProject}.iam.gserviceaccount.com`, private_key: serviceKey }) };
  const route = `${origin}/v1/${localPrefix}/entitlements/${uid}`;
  const now = Math.floor(Date.now() / 1000);
  let injectRace = false, commitRequests = 0, tokenRequests = 0;
  const adminPatch = fields => fetch(route, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  const transport = async (input, init) => {
    const url = new URL(input);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      tokenRequests++;
      return Response.json({ access_token: 'synthetic-token-never-sent-outside-local-fixture', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(url.hostname, 'firestore.googleapis.com');
    assert.ok(url.pathname.startsWith(`/v1/${fixedPrefix}`));
    if (url.pathname.endsWith('/documents:commit')) {
      commitRequests++;
      if (injectRace) {
        injectRace = false;
        const changed = await adminPatch({ adminBlocked: { booleanValue: true }, note: { stringValue: 'Concurrent admin note' } });
        assert.equal(changed.status, 200);
      }
    }
    const rewritten = `${origin}${url.pathname.replace(fixedPrefix, localPrefix)}${url.search}`;
    const localBody = typeof init.body === 'string' ? init.body.replaceAll(fixedPrefix, localPrefix) : init.body;
    const result = await fetch(rewritten, { ...init, body: localBody, headers: { ...init.headers, Authorization: 'Bearer owner' } });
    const body = await result.text();
    // The production provider is permanently project-pinned. Only this local
    // test transport translates project names and uses the emulator owner key.
    return new Response(body.replaceAll(localPrefix, fixedPrefix), { status: result.status, headers: result.headers });
  };
  const factory = sourceProject === 'minimalpairs' ? createFirebaseAdapter : createSandboxFirebaseAdapter;
  const adapter = factory(env, { expectedLivemode: sourceProject === 'minimalpairs', fetchImpl: transport });
  const grant = { schemaVersion: 1, active: true, plan: 'monthly', currentPeriodEnd: now + 3600, updatedAt: now, status: 'active', reason: 'paid_period', customerId: 'cus_fixture', subscriptionId: 'sub_fixture' };
  await adapter.entitlements.projectSubscription(uid, grant);
  let current = await (await fetch(route, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(current.fields.active.booleanValue, true);
  assert.equal(current.fields.plan.stringValue, 'monthly');
  injectRace = true;
  await adapter.entitlements.projectSubscription(uid, { ...grant, updatedAt: now + 1 });
  current = await (await fetch(route, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(current.fields.active.booleanValue, false);
  assert.equal(current.fields.adminBlocked.booleanValue, true);
  assert.equal(current.fields.note.stringValue, 'Concurrent admin note');
  assert.equal(current.fields.reason.stringValue, 'admin_blocked');
  assert.equal(commitRequests, 3);
  assert.equal(tokenRequests, 1);
  assert.equal(await adapter.legacyEntitlement('missing@example.invalid'), null);
});
