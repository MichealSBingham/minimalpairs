import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSandboxFirebaseAdapter } from '../providers/firebase.mjs';
import { STRIPE_API_VERSION } from '../providers/stripe.mjs';
import { isSandboxProbeKey } from './sandbox-probe-state.mjs';
import { lockRuntimeState, privateJson } from './runtime-sandbox-state.mjs';

export const SANDBOX = Object.freeze({ project: 'minimalpairs-billing-sandbox',
  serviceAccount: 'minimalpairs-billing@minimalpairs-billing-sandbox.iam.gserviceaccount.com',
  appId: '1:350102033623:web:fa7a7f474fd7346218cc92', stripeAccount: 'acct_1UKqIpJlJ2EM69u7' });
const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultPrivate = path.resolve(directory, '../private');
const accountUrl = `https://iam.googleapis.com/v1/projects/${SANDBOX.project}/serviceAccounts/${SANDBOX.serviceAccount}`;
const keyUrl = `${accountUrl}/keys`;
const authUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const documentName = uid => `projects/${SANDBOX.project}/databases/(default)/documents/entitlements/${uid}`;
const fail = code => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const string = value => typeof value === 'string' && value.length >= 20 && value.length <= 16384;
const safeError = error => /^sandbox_[a-z_]+$/.test(error?.message || '') ? error.message : 'sandbox_operation_failed';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value > 0;
const apiKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);
const keyCreationWindowMs = 20000;

async function ownerAccessToken() {
  const require = createRequire(import.meta.url);
  const auth = require(path.resolve(directory, '../../app/node_modules/firebase-tools/lib/auth.js'));
  const owner = auth.getProjectDefaultAccount(path.resolve(directory, '../../app'));
  requireValue(owner?.tokens?.refresh_token, 'sandbox_owner_login_required');
  const access = await auth.getAccessToken(owner.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  requireValue(string(access.access_token), 'sandbox_owner_login_required');
  return access.access_token;
}
function validate(state) {
  requireValue(state?.schemaVersion === 1 && state.project === SANDBOX.project && state.serviceAccount === SANDBOX.serviceAccount
    && state.stripeAccount === SANDBOX.stripeAccount && /^[a-f0-9-]{36}$/.test(state.runId || '')
    && /^runtime_[a-f0-9]{32}$/.test(state.uid || '') && state.email === `${state.uid}@example.invalid`
    && timestamp(state.createdAt) && record(state.key) && record(state.identity), 'sandbox_checkpoint_invalid');
  for (const value of [state.key.attemptedAt, state.identity.attemptedAt]) {
    requireValue(value === undefined || timestamp(value), 'sandbox_checkpoint_invalid');
  }
  if (state.apiKey !== undefined) requireValue(apiKey(state.apiKey), 'sandbox_checkpoint_invalid');
  if (state.key.uniqueId !== undefined) requireValue(/^\d{1,30}$/.test(state.key.uniqueId), 'sandbox_checkpoint_invalid');
  if (state.key.name || state.key.credentials) requireValue(timestamp(state.key.attemptedAt), 'sandbox_checkpoint_invalid');
  if (state.identity.created) requireValue(timestamp(state.identity.attemptedAt), 'sandbox_checkpoint_invalid');
  if (state.key.name) requireValue(isSandboxProbeKey(state.key.name, SANDBOX.project, SANDBOX.serviceAccount, state.key.uniqueId), 'sandbox_key_scope_invalid');
  if (state.key.credentials) {
    const c = state.key.credentials;
    requireValue(c.type === 'service_account' && c.project_id === SANDBOX.project && c.client_email === SANDBOX.serviceAccount
      && c.client_id === state.key.uniqueId && c.private_key_id === state.key.name?.split('/').at(-1)
      && string(c.private_key) && c.private_key.startsWith('-----BEGIN PRIVATE KEY-----'), 'sandbox_credentials_invalid');
  }
  return state;
}

/** Dependency injection is for offline fixtures only; CLI has no environment/project overrides. */
export function createRuntimeSandboxOperator({ privateDir = defaultPrivate, fetchImpl = globalThis.fetch,
  getOwnerToken = ownerAccessToken, now = Date.now, verifyIdentity = async (token, credentials) =>
    createSandboxFirebaseAdapter({ FIREBASE_PROJECT_ID: SANDBOX.project, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) },
      { expectedLivemode: false }).auth.verifyIdToken(token) } = {}) {
  async function request(url, { method = 'GET', token, body, form, allowed = [200], headers = {} } = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(url, { method, redirect: 'error', signal: controller.signal,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), ...(form ? { body: new URLSearchParams(form).toString() } : {}) });
      const reader = response.body?.getReader(); const chunks = []; let length = 0;
      const abort = () => { void reader?.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        if (reader) while (true) {
          const { done, value } = await reader.read();
          requireValue(!controller.signal.aborted, 'sandbox_request_failed');
          if (done) break; length += value.length;
          requireValue(length <= 1000000, 'sandbox_response_invalid'); chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', abort); reader?.releaseLock(); }
      requireValue(!controller.signal.aborted, 'sandbox_request_failed');
      const text = Buffer.concat(chunks).toString('utf8'); let data;
      try { data = text ? JSON.parse(text) : {}; } catch { fail('sandbox_response_invalid'); }
      requireValue(allowed.includes(response.status), 'sandbox_request_failed');
      return { status: response.status, data };
    } catch (error) { fail(safeError(error)); } finally { clearTimeout(timer); controller.abort(); }
  }
  async function locked(action) {
    const store = lockRuntimeState(privateDir);
    try { return await action(store, store.read()); }
    catch (error) { fail(safeError(error)); }
    finally { store.release(); }
  }
  const stripeCredentials = () => {
    const c = privateJson(path.join(privateDir, 'stripe-sandbox.json'));
    requireValue(c.accountId === SANDBOX.stripeAccount && c.livemode === false && /^sk_test_[A-Za-z0-9]{20,200}$/.test(c.secretKey || ''), 'sandbox_stripe_credentials_invalid');
    return c;
  };
  async function verifiedStripeCredentials() {
    const stripe = stripeCredentials();
    const { data } = await request('https://api.stripe.com/v1/account', { token: stripe.secretKey,
      headers: { 'Stripe-Version': STRIPE_API_VERSION } });
    requireValue(data.id === SANDBOX.stripeAccount && data.object === 'account', 'sandbox_stripe_account_mismatch');
    return stripe;
  }
  async function user(state, token) {
    const { data } = await request(`${authUrl}lookup`, { method: 'POST', token,
      body: { targetProjectId: SANDBOX.project, localId: [state.uid] } });
    requireValue(!data.users || Array.isArray(data.users), 'sandbox_user_invalid');
    if (!data.users?.length) return null;
    requireValue(data.users.length === 1 && data.users[0].localId === state.uid && data.users[0].email === state.email
      && !data.users[0].tenantId, 'sandbox_user_scope_invalid');
    return data.users[0];
  }
  async function fresh(state, store, initial = false) {
    requireValue(!state.cleanupStarted && !state.identity.disabled && !state.identity.deleted && !state.key.deleted
      && state.identity.created && state.key.credentials && apiKey(state.apiKey), 'sandbox_identity_unavailable');
    const owner = await getOwnerToken(); const current = await user(state, owner);
    requireValue(current?.emailVerified === true && current.disabled !== true, 'sandbox_identity_unavailable');
    let data;
    if (initial) {
      requireValue(string(state.password), 'sandbox_credentials_invalid');
      ({ data } = await request(`${authUrl}signInWithPassword?key=${encodeURIComponent(state.apiKey)}`, {
        method: 'POST', body: { email: state.email, password: state.password, returnSecureToken: true } }));
      requireValue(data.localId === state.uid, 'sandbox_identity_mismatch');
    } else {
      requireValue(string(state.refreshToken), 'sandbox_refresh_unavailable');
      const result = await request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(state.apiKey)}`, {
        method: 'POST', form: { grant_type: 'refresh_token', refresh_token: state.refreshToken } });
      requireValue(result.data.user_id === state.uid && result.data.project_id === '350102033623', 'sandbox_identity_mismatch');
      data = { idToken: result.data.id_token, refreshToken: result.data.refresh_token };
    }
    requireValue(string(data.idToken) && string(data.refreshToken), 'sandbox_token_invalid');
    // The real provider checks signature, exact project issuer/audience and current
    // account state/revocation. A decoded JWT or refresh response is insufficient.
    const identity = await verifyIdentity(data.idToken, state.key.credentials);
    requireValue(identity.uid === state.uid && identity.email === state.email && identity.emailVerified === true
      && identity.serverVerified === true, 'sandbox_identity_mismatch');
    // A newly rotated local Stripe key must still resolve to the exact Sandbox.
    const stripe = await verifiedStripeCredentials();
    state.refreshToken = data.refreshToken; state.lastVerifiedAt = now(); store.save(state);
    return { uid: state.uid, idToken: data.idToken, serviceCredentials: structuredClone(state.key.credentials),
      stripeSecretKey: stripe.secretKey, projectId: SANDBOX.project, stripeAccountId: SANDBOX.stripeAccount };
  }
  async function prepare() {
    return locked(async (store, existing) => {
      let state = existing ? validate(existing) : { schemaVersion: 1, project: SANDBOX.project, serviceAccount: SANDBOX.serviceAccount,
        stripeAccount: SANDBOX.stripeAccount, runId: randomUUID(), uid: `runtime_${randomUUID().replaceAll('-', '')}`,
        createdAt: now(), password: randomBytes(32).toString('base64url'), key: {}, identity: {} };
      if (!existing) { state.email = `${state.uid}@example.invalid`; store.save(state); }
      requireValue(!state.cleanupStarted && !state.identity.disabled && !state.identity.deleted && !state.key.deleted, 'sandbox_identity_unavailable');
      const token = await getOwnerToken();
      const { data: billing } = await request(`https://cloudbilling.googleapis.com/v1/projects/${SANDBOX.project}/billingInfo`, { token });
      requireValue(billing.billingEnabled === false, 'sandbox_billing_must_be_disabled');
      const { data: config } = await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${SANDBOX.project}/config`, { token });
      requireValue(['FIREBASE_AUTH', 'IDENTITY_PLATFORM'].includes(config.subtype) && config.signIn?.email?.enabled === true, 'sandbox_auth_not_ready');
      const { data: sdk } = await request(`https://firebase.googleapis.com/v1beta1/projects/${SANDBOX.project}/webApps/${SANDBOX.appId}/config`, { token });
      requireValue(sdk.projectId === SANDBOX.project && sdk.appId === SANDBOX.appId && apiKey(sdk.apiKey), 'sandbox_app_mismatch');
      state.apiKey = sdk.apiKey;
      const { data: account } = await request(accountUrl, { token });
      requireValue(account.projectId === SANDBOX.project && account.email === SANDBOX.serviceAccount && account.disabled !== true
        && /^\d{1,30}$/.test(account.uniqueId || ''), 'sandbox_service_account_invalid');
      requireValue(!state.key.uniqueId || state.key.uniqueId === account.uniqueId, 'sandbox_service_account_changed');
      state.key.uniqueId = account.uniqueId; store.save(state);
      await verifiedStripeCredentials();
      if (!state.key.attemptedAt) {
        const { data: keys } = await request(`${keyUrl}?keyTypes=USER_MANAGED`, { token });
        requireValue(Array.isArray(keys.keys || []) && (keys.keys || []).length === 0, 'sandbox_preexisting_key');
        state.key.attemptedAt = now(); store.save(state);
        const { data: key } = await request(keyUrl, { method: 'POST', token,
          body: { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' } });
        requireValue(isSandboxProbeKey(key.name, SANDBOX.project, SANDBOX.serviceAccount, state.key.uniqueId), 'sandbox_key_scope_invalid');
        state.key.name = key.name; store.save(state); // retain deletion authority even if credential decoding fails
        try { state.key.credentials = JSON.parse(Buffer.from(key.privateKeyData, 'base64').toString('utf8')); }
        catch { fail('sandbox_credentials_invalid'); }
        validate(state); store.save(state);
      }
      requireValue(state.key.credentials, 'sandbox_key_creation_uncertain');
      if (!state.identity.attemptedAt) {
        requireValue(await user(state, token) === null, 'sandbox_preexisting_user');
        state.identity.attemptedAt = now(); store.save(state);
        await request(`${authUrl}signUp`, { method: 'POST', token, body: { targetProjectId: SANDBOX.project,
          localId: state.uid, email: state.email, password: state.password, emailVerified: true } });
      }
      const current = await user(state, token);
      requireValue(current?.emailVerified === true && current.disabled !== true, 'sandbox_user_creation_uncertain');
      state.identity.created = true; store.save(state);
      await fresh(state, store, !state.refreshToken);
      return status(state);
    });
  }
  async function refresh() { return locked(async (store, state) => fresh(validate(state), store)); }
  const status = state => ({ prepared: Boolean(state?.identity.created && state?.key.credentials && !state.cleanupStarted
    && !state.identity.disabled && !state.identity.deleted), userDisabled: state?.identity.disabled === true,
    userDeleted: state?.identity.deleted === true, keyDeleted: state?.key.deleted === true,
    cleanupComplete: state?.cleanupComplete === true, keyCreationUncertain: Boolean(state?.key.attemptedAt && !state.key.name) });
  async function disableUser() {
    return locked(async (store, raw) => {
      const state = validate(raw); const token = await getOwnerToken();
      requireValue(state.identity.attemptedAt && !state.identity.deleted, 'sandbox_identity_unavailable');
      const current = await user(state, token); requireValue(current, 'sandbox_identity_unavailable');
      state.identity.disableAttemptedAt = now(); store.save(state);
      if (current.disabled !== true) await request(`${authUrl}update`, { method: 'POST', token,
        body: { targetProjectId: SANDBOX.project, localId: state.uid, disableUser: true } });
      requireValue((await user(state, token))?.disabled === true, 'sandbox_user_disable_unconfirmed');
      state.identity.disabled = true; delete state.refreshToken; delete state.password; store.save(state);
      return status(state);
    });
  }
  async function removeUser(state, store, token) {
    if (!state.identity.attemptedAt) { state.identity.deleted = true; store.save(state); return; }
    const current = await user(state, token);
    if (current) {
      state.identity.deleteAttemptedAt = now(); store.save(state);
      await request(`${authUrl}delete`, { method: 'POST', token, body: { targetProjectId: SANDBOX.project, localId: state.uid } });
    }
    requireValue(await user(state, token) === null, 'sandbox_user_delete_unconfirmed');
    state.identity.deleted = true; delete state.refreshToken; delete state.password; store.save(state);
  }
  async function deleteUser() { return locked(async (store, raw) => {
    const state = validate(raw); await removeUser(state, store, await getOwnerToken()); return status(state);
  }); }
  async function cleanup({ runtimeStopped = false } = {}) {
    requireValue(runtimeStopped === true, 'sandbox_stop_runtime_first');
    return locked(async (store, raw) => {
      const state = validate(raw); state.cleanupStarted = true; store.save(state);
      const token = await getOwnerToken(); const failures = [];
      const attempt = async fn => { try { await fn(); } catch (error) { failures.push(safeError(error)); } };
      await attempt(() => removeUser(state, store, token));
      await attempt(async () => {
        // A failed preflight has no authority over a pre-existing UID's data.
        if (!state.identity.attemptedAt) { state.documentDeleted = true; store.save(state); return; }
        const url = `https://firestore.googleapis.com/v1/${documentName(state.uid)}`;
        const { status: code, data } = await request(url, { token, allowed: [200, 404] });
        if (code === 200) {
          requireValue(data.name === documentName(state.uid) && typeof data.updateTime === 'string', 'sandbox_document_scope_invalid');
          await request(url + `?currentDocument.updateTime=${encodeURIComponent(data.updateTime)}`, { method: 'DELETE', token, allowed: [200, 404] });
        }
        requireValue((await request(url, { token, allowed: [200, 404] })).status === 404, 'sandbox_document_delete_unconfirmed');
        state.documentDeleted = true; store.save(state);
      });
      await attempt(async () => {
        if (state.key.attemptedAt && !state.key.name) fail('sandbox_key_creation_uncertain');
        if (state.key.name) {
          const url = `https://iam.googleapis.com/v1/${state.key.name}`;
          const { status: code, data } = await request(url, { token, allowed: [200, 404] });
          if (code === 200) {
            requireValue(data.name === state.key.name && data.keyType === 'USER_MANAGED', 'sandbox_key_scope_invalid');
            await request(url, { method: 'DELETE', token, allowed: [200, 404] });
          }
          requireValue((await request(url, { token, allowed: [200, 404] })).status === 404, 'sandbox_key_delete_unconfirmed');
        }
        state.key.deleted = true; delete state.key.credentials; store.save(state);
      });
      state.cleanupComplete = state.identity.deleted === true && state.documentDeleted === true && state.key.deleted === true;
      store.save(state);
      if (failures.length) fail('sandbox_cleanup_incomplete');
      return status(state);
    });
  }
  async function adoptKeyForCleanup(keyId) {
    requireValue(/^[A-Za-z0-9_-]{1,200}$/.test(keyId || ''), 'sandbox_key_scope_invalid');
    return locked(async (store, raw) => {
      const state = validate(raw);
      requireValue(state.key.attemptedAt && !state.key.name && !state.key.credentials, 'sandbox_key_recovery_not_needed');
      const name = `projects/${SANDBOX.project}/serviceAccounts/${SANDBOX.serviceAccount}/keys/${keyId}`;
      const { data } = await request(`https://iam.googleapis.com/v1/${name}`, { token: await getOwnerToken() });
      requireValue(isSandboxProbeKey(data.name, SANDBOX.project, SANDBOX.serviceAccount, state.key.uniqueId)
        && data.name.split('/').at(-1) === keyId && data.keyType === 'USER_MANAGED'
        && Number.isFinite(Date.parse(data.validAfterTime)) && Date.parse(data.validAfterTime) >= state.key.attemptedAt - 1000
        && Date.parse(data.validAfterTime) <= state.key.attemptedAt + keyCreationWindowMs,
      'sandbox_key_scope_invalid');
      state.key.name = data.name; state.cleanupStarted = true; store.save(state);
      return status(state);
    });
  }
  return { prepare, refresh, disableUser, deleteUser, cleanup, adoptKeyForCleanup,
    status: () => locked(async (_store, state) => status(state ? validate(state) : null)) };
}

// Importing this file performs no I/O. Credentials are returned only to an
// operator in this process, never printed or placed in arguments/environment.
export const getFreshRuntimeSandboxIdentity = () => createRuntimeSandboxOperator().refresh();
export const prepareRuntimeSandboxIdentity = () => createRuntimeSandboxOperator().prepare();

export async function main(args = process.argv.slice(2)) {
  const mode = args[0]; const op = createRuntimeSandboxOperator();
  if (args.length === 1 && mode === '--prepare') return op.prepare();
  if (args.length === 1 && mode === '--refresh') { await op.refresh(); return { freshVerifiedIdentity: true }; }
  if (args.length === 1 && mode === '--status') return op.status();
  if (args.length === 1 && mode === '--disable-user') return op.disableUser();
  if (args.length === 1 && mode === '--delete-user') return op.deleteUser();
  if (args.length === 2 && mode === '--cleanup' && args[1] === '--confirm-runtime-stopped') return op.cleanup({ runtimeStopped: true });
  if (args.length === 2 && mode === '--adopt-key-for-cleanup') return op.adoptKeyForCleanup(args[1]);
  return { action: 'none', help: 'Explicit modes: --prepare, --refresh, --status, --disable-user, --delete-user, --cleanup --confirm-runtime-stopped, --adopt-key-for-cleanup KEY_ID. No default network calls.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(JSON.stringify({ result: 'failed', code: safeError(error) })); process.exitCode = 1; }
}
