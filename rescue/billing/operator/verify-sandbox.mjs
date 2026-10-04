import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { createSandboxFirebaseAdapter, createFirebaseAdapter } from '../providers/firebase.mjs';
import { claimProbeCheckpoint, isSandboxProbeKey } from './sandbox-probe-state.mjs';

// Explicit local operator probe; never loaded by the app or Worker. Only a new
// synthetic .invalid identity and its own documents are written or removed.
if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
  console.log('Use --execute to verify the isolated free Sandbox with a temporary service key and synthetic account. No emails or Stripe calls.');
  process.exit(0);
}
const project = 'minimalpairs-billing-sandbox';
const appId = '1:350102033623:web:fa7a7f474fd7346218cc92';
const account = `minimalpairs-billing@${project}.iam.gserviceaccount.com`;
const keyBase = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${account}/keys`;
const directory = path.dirname(fileURLToPath(import.meta.url));
const privateDirectory = path.resolve(directory, '../private');
fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(privateDirectory, 0o700);
const checkpoint = path.join(privateDirectory, 'sandbox-probe-pending.json');
const uid = `probe_${randomUUID().replaceAll('-', '')}`;
const email = `${uid}@example.invalid`;
const password = randomBytes(32).toString('base64url');
const documentUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/entitlements/${uid}`;
const result = { project, startedAt: new Date().toISOString(), checks: [], cleanup: {}, emailsSent: 0, stripeCalls: 0 };
let request, keyName, keyCreationAttempted = false, identityAttempted = false, writeAttempted = false;
const state = () => ({ project, uid, keyName, keyCreationAttempted, identityAttempted, writeAttempted });
const journal = claimProbeCheckpoint(checkpoint, state());
const record = () => journal.update(state());
try {
  const require = createRequire(import.meta.url);
  const auth = require(path.resolve(directory, '../../app/node_modules/firebase-tools/lib/auth.js'));
  const owner = auth.getProjectDefaultAccount(path.resolve(directory, '../../app'));
  const access = await auth.getAccessToken(owner.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  request = async (url, method = 'GET', body, bearer = access.access_token, allowed = [200]) => {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!allowed.includes(response.status)) throw new Error(`probe_http_${response.status}_${/^[A-Z_]+$/.test(data.error?.status || '') ? data.error.status : 'FAILED'}`);
    return { status: response.status, data };
  };
  const billing = await request(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
  assert.equal(billing.data.billingEnabled, false);
  const config = await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`);
  assert.ok(['FIREBASE_AUTH', 'IDENTITY_PLATFORM'].includes(config.data.subtype));
  assert.equal(config.data.signIn.email.enabled, true);
  result.authenticationSubtype = config.data.subtype;
  result.checks.push('free_firebase_auth_and_billing_disabled');
  const sdk = (await request(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps/${appId}/config`)).data;
  assert.equal(sdk.projectId, project); assert.equal(sdk.appId, appId); assert.ok(sdk.apiKey);
  const beforeKeys = (await request(`${keyBase}?keyTypes=USER_MANAGED`)).data.keys || [];
  assert.equal(beforeKeys.length, 0);
  const serviceAccount = (await request(keyBase.slice(0, -5))).data;
  assert.equal(serviceAccount.projectId, project); assert.equal(serviceAccount.email, account);
  keyCreationAttempted = true;
  record();
  const key = (await request(keyBase, 'POST', { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' })).data;
  assert.ok(isSandboxProbeKey(key.name, project, account, serviceAccount.uniqueId));
  keyName = key.name; record();
  const credentials = JSON.parse(Buffer.from(key.privateKeyData, 'base64').toString('utf8'));
  const env = { FIREBASE_PROJECT_ID: project, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) };
  assert.throws(() => createFirebaseAdapter(env, { expectedLivemode: true }), /firebase_not_configured/);
  const adapter = createSandboxFirebaseAdapter(env, { expectedLivemode: false });
  result.checks.push('production_factory_rejects_sandbox_credentials');
  identityAttempted = true; record();
  await request('https://identitytoolkit.googleapis.com/v1/accounts:signUp', 'POST', { targetProjectId: project, localId: uid, email, password, emailVerified: true });
  const signInResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(sdk.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const signIn = await signInResponse.json();
  assert.equal(signInResponse.status, 200); assert.equal(signIn.localId, uid);
  const identity = await adapter.auth.verifyIdToken(signIn.idToken);
  assert.deepEqual(identity, { uid, email, emailVerified: true, serverVerified: true });
  result.checks.push('real_signed_id_token_and_current_account_lookup');
  assert.equal(await adapter.legacyEntitlement(email), null);
  result.checks.push('real_missing_legacy_grant_read');
  const timestamp = Math.floor(Date.now() / 1000);
  const projection = { schemaVersion: 1, active: true, plan: 'monthly', currentPeriodEnd: timestamp + 3600,
    updatedAt: timestamp, status: 'active', reason: 'paid_period', customerId: 'cus_syntheticprobe', subscriptionId: 'sub_syntheticprobe' };
  writeAttempted = true; record();
  assert.deepEqual(await adapter.entitlements.projectSubscription(uid, projection), { written: true, adminBlocked: false });
  const stored = (await request(documentUrl)).data;
  assert.equal(stored.fields.active.booleanValue, true);
  assert.equal(stored.fields.customerId.stringValue, projection.customerId);
  result.checks.push('real_service_account_conditional_firestore_create');
  await request(`${documentUrl}?updateMask.fieldPaths=adminBlocked&updateMask.fieldPaths=note`, 'PATCH', {
    fields: { adminBlocked: { booleanValue: true }, note: { stringValue: 'Synthetic Sandbox administrator block' } },
  });
  assert.deepEqual(await adapter.entitlements.projectSubscription(uid, { ...projection, updatedAt: timestamp + 1 }), { written: true, adminBlocked: true });
  const blocked = (await request(documentUrl)).data;
  assert.equal(blocked.fields.active.booleanValue, false);
  assert.equal(blocked.fields.note.stringValue, 'Synthetic Sandbox administrator block');
  result.checks.push('real_conditional_update_preserves_admin_block_and_unrelated_field');
  const signer = await importPKCS8(credentials.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(account).setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(timestamp).setExpirationTime(timestamp + 3600).sign(signer);
  const oauth = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), redirect: 'error', signal: AbortSignal.timeout(20000) });
  const token = await oauth.json(); assert.equal(oauth.status, 200); assert.ok(token.access_token);
  const denied = await request(documentUrl.replace(`/projects/${project}/`, '/projects/minimalpairs/'), 'GET', undefined, token.access_token, [403]);
  assert.equal(denied.data.error.status, 'PERMISSION_DENIED');
  result.checks.push('sandbox_service_identity_denied_production_firestore_read');
  await request('https://identitytoolkit.googleapis.com/v1/accounts:update', 'POST', { targetProjectId: project, localId: uid, disableUser: true });
  await assert.rejects(adapter.auth.verifyIdToken(signIn.idToken), /firebase_identity_unavailable/);
  result.checks.push('real_disabled_account_rejected_with_previously_valid_token');
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = /^[a-zA-Z0-9_]+$/.test(error?.message || '') ? error.message : 'probe_assertion_or_transport_failed';
} finally {
  if (request) {
    if (writeAttempted) try { await request(documentUrl, 'DELETE', undefined, undefined, [200, 404]); result.cleanup.documentRemoved = true; } catch { result.cleanup.documentRemoved = false; }
    if (identityAttempted) try { await request('https://identitytoolkit.googleapis.com/v1/accounts:delete', 'POST', { targetProjectId: project, localId: uid }); result.cleanup.identityRemoved = true; } catch { result.cleanup.identityRemoved = false; }
    if (keyName) try {
      await request(`https://iam.googleapis.com/v1/${keyName}`, 'DELETE');
      // The list endpoint can briefly retain the deleted entry. Verify this
      // exact key by resource name instead of interpreting list lag as failure.
      result.cleanup.temporaryKeyRemoved = (await request(`https://iam.googleapis.com/v1/${keyName}`, 'GET', undefined, undefined, [404])).status === 404;
    } catch { result.cleanup.temporaryKeyRemoved = false; }
  }
  result.completedAt = new Date().toISOString();
  const cleanupComplete = Object.values(result.cleanup).every(Boolean)
    && (!keyCreationAttempted || Boolean(keyName && result.cleanup.temporaryKeyRemoved))
    && (!identityAttempted || result.cleanup.identityRemoved === true)
    && (!writeAttempted || result.cleanup.documentRemoved === true);
  if (cleanupComplete) journal.release();
  result.cleanupComplete = cleanupComplete;
  fs.writeFileSync(path.resolve(directory, '../../qa/billing-sandbox-live-probe-2026-09-28.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed || !cleanupComplete) process.exitCode = 1;
}
