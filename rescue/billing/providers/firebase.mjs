import { decodeProtectedHeader, importPKCS8, importX509, jwtVerify, SignJWT } from 'jose';

const PRODUCTION_PROJECT = 'minimalpairs';
const SANDBOX_PROJECT = 'minimalpairs-billing-sandbox';
const CERTIFICATES = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit';
const UID = /^[A-Za-z0-9:_-]{1,128}$/;
const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => { throw new Error(code); };
const emailKey = value => {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value.trim())) fail('firebase_invalid_email');
  return value.trim().toLowerCase();
};

/** Production and Sandbox factories cannot exchange credentials or destinations. */
export function createFirebaseAdapter(env, options = {}) {
  if (options.expectedLivemode !== true) fail('firebase_not_configured');
  return createPinnedFirebaseAdapter(PRODUCTION_PROJECT, env, options);
}

export function createSandboxFirebaseAdapter(env, options = {}) {
  if (options.expectedLivemode !== false) fail('firebase_not_configured');
  return createPinnedFirebaseAdapter(SANDBOX_PROJECT, env, options);
}

function createPinnedFirebaseAdapter(PROJECT, env, { getOperationContext = () => null,
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  if (env.FIREBASE_PROJECT_ID !== PROJECT || typeof getOperationContext !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) fail('firebase_not_configured');
  let credentials;
  try { credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { fail('firebase_not_configured'); }
  if (credentials?.type !== 'service_account' || credentials.project_id !== PROJECT
    || !new RegExp(`^[a-z0-9-]+@${PROJECT}\\.iam\\.gserviceaccount\\.com$`).test(credentials.client_email || '')
    || typeof credentials.private_key !== 'string' || !credentials.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) fail('firebase_not_configured');
  const issuer = credentials.client_email;
  let signingKey, accessToken, certificates;
  const imported = new Map();

  function checkOperation(operation) {
    if (operation.signal?.aborted || operation.deadline <= now()) fail('firebase_operation_expired');
  }
  function startOperation() {
    const shared = getOperationContext();
    if (shared !== null && (typeof shared !== 'object' || !Number.isFinite(shared.deadline)
      || !(shared.signal instanceof AbortSignal))) fail('firebase_invalid_operation');
    const operation = { signal: shared?.signal, deadline: Math.min(now() + 20000, shared?.deadline ?? Infinity) };
    checkOperation(operation);
    return operation;
  }

  async function jsonRequest(url, init = {}, allowMissing = false, operation) {
    checkOperation(operation);
    const controller = new AbortController();
    const abort = () => controller.abort();
    operation.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(timeoutMs, operation.deadline - now()));
    try {
      const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        fail('firebase_redirect_rejected');
      }
      if (controller.signal.aborted) fail('firebase_request_failed');
      checkOperation(operation);
      if (allowMissing && response.status === 404) {
        // No body is needed for an absent document. Cancel both the actual
        // transport and any independently supplied body before returning.
        controller.abort();
        void response.body?.cancel().catch(() => {});
        return { missing: true };
      }
      const reader = response.body?.getReader();
      if (!reader) fail('firebase_invalid_response');
      const cancelBody = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancelBody, { once: true });
      const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) fail('firebase_request_failed');
          checkOperation(operation);
          if (done) break;
          length += value.byteLength;
          if (length > 262144) { await reader.cancel(); fail('firebase_response_too_large'); }
          chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('firebase_invalid_response'); }
      if (!response.ok) {
        // Keep only a fixed protocol status; never expose the provider message,
        // document path, response body, credential or account information.
        const error = new Error('firebase_request_failed'); error.httpStatus = response.status;
        if (['FAILED_PRECONDITION', 'ABORTED'].includes(data?.error?.status)) error.providerCode = data.error.status;
        throw error;
      }
      return { data, headers: response.headers };
    } catch (error) {
      if (error?.message?.startsWith('firebase_')) throw error;
      fail('firebase_request_failed');
    } finally { clearTimeout(timer); operation.signal?.removeEventListener('abort', abort); }
  }

  async function serviceToken(operation) {
    checkOperation(operation);
    if (accessToken && accessToken.expiresAt > now() + 60000) return accessToken.value;
    // Share completed cache entries only. Sharing an in-flight request across
    // workflows would tie one caller's cancellation to another caller's wait.
    return (async () => {
      signingKey ??= importPKCS8(credentials.private_key, 'RS256');
      const issued = Math.floor(now() / 1000);
      const assertion = await new SignJWT({ scope: SCOPES }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(issuer).setAudience(TOKEN_URL).setIssuedAt(issued).setExpirationTime(issued + 3600).sign(await signingKey);
      const { data } = await jsonRequest(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }, false, operation);
      if (typeof data.access_token !== 'string' || data.access_token.length < 20 || data.access_token.length > 8192 || data.token_type !== 'Bearer'
        || !Number.isInteger(data.expires_in) || data.expires_in < 120 || data.expires_in > 3600) fail('firebase_invalid_service_token');
      accessToken = { value: data.access_token, expiresAt: now() + data.expires_in * 1000 };
      return accessToken.value;
    })();
  }

  async function googleKey(kid, operation) {
    checkOperation(operation);
    if (!certificates || certificates.expiresAt <= now()) {
      await (async () => {
        const { data, headers } = await jsonRequest(CERTIFICATES, {}, false, operation);
        if (!data || Array.isArray(data) || Object.keys(data).length < 1 || Object.keys(data).length > 20
          || Object.entries(data).some(([id, cert]) => !/^[\w-]{1,128}$/.test(id) || typeof cert !== 'string' || !cert.startsWith('-----BEGIN CERTIFICATE-----'))) fail('firebase_invalid_keys');
        const maxAge = Number(headers.get('Cache-Control')?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] || 0);
        const age = Math.max(0, Number(headers.get('Age') || 0));
        const ttl = Number.isFinite(age) ? Math.max(0, Math.min(maxAge - age, 86400)) : 0;
        certificates = { values: data, expiresAt: now() + ttl * 1000 };
        imported.clear();
      })();
    }
    // Honor Google's key cache lifetime; arbitrary unknown kid values cannot
    // trigger unbounded forced refetches within that lifetime.
    if (!own(certificates.values, kid)) fail('firebase_unknown_key');
    if (!imported.has(kid)) imported.set(kid, importX509(certificates.values[kid], 'RS256'));
    return imported.get(kid);
  }

  async function authorized(url, init = {}, allowMissing = false, operation) {
    return jsonRequest(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await serviceToken(operation)}` } }, allowMissing, operation);
  }

  async function verifyIdToken(token) {
    try {
      const operation = startOperation();
      if (typeof token !== 'string' || token.length < 20 || token.length > 8192) fail('firebase_invalid_identity');
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256' || !/^[\w-]{1,128}$/.test(header.kid || '') || header.jku || header.jwk || header.x5u) fail('firebase_invalid_identity');
      const { payload } = await jwtVerify(token, await googleKey(header.kid, operation), { algorithms: ['RS256'], audience: PROJECT,
        issuer: `https://securetoken.google.com/${PROJECT}`, currentDate: new Date(now()), clockTolerance: 0,
        requiredClaims: ['sub', 'aud', 'iss', 'exp', 'iat', 'auth_time', 'email', 'email_verified'] });
      const seconds = Math.floor(now() / 1000);
      if (!UID.test(payload.sub || '') || payload.aud !== PROJECT || !whole(payload.exp) || !whole(payload.iat) || !whole(payload.auth_time)
        || payload.iat > seconds || payload.auth_time > payload.iat || payload.exp <= seconds || payload.exp <= payload.iat
        || payload.email_verified !== true || payload.firebase?.tenant) fail('firebase_invalid_identity');
      const email = emailKey(payload.email);
      const { data } = await authorized(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup?fields=users(localId,email,emailVerified,validSince,disabled,tenantId)`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [payload.sub] }),
      }, false, operation);
      const user = data?.users?.length === 1 ? data.users[0] : null;
      if (!user || user.localId !== payload.sub || user.emailVerified !== true || emailKey(user.email) !== email
        || user.tenantId || (own(user, 'disabled') && typeof user.disabled !== 'boolean') || user.disabled === true
        || (own(user, 'validSince') && !/^\d{1,12}$/.test(user.validSince))
        || Number(user.validSince || 0) > payload.auth_time) fail('firebase_invalid_identity');
      return { uid: payload.sub, email, emailVerified: true, serverVerified: true };
    } catch { fail('firebase_identity_unavailable'); }
  }

  const documentName = (collection, id) => `projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`;
  const documentUrl = (collection, id) => `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  async function readDocument(collection, id, operation) {
    const result = await authorized(documentUrl(collection, id), {}, true, operation);
    if (result.missing) return null;
    if (result.data?.name !== documentName(collection, id) || !result.data.fields || typeof result.data.fields !== 'object'
      || typeof result.data.updateTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(result.data.updateTime)) fail('firebase_invalid_document');
    return result.data;
  }
  async function legacyEntitlement(email) {
    const document = await readDocument('legacyEntitlements', emailKey(email), startOperation());
    if (!document) return null;
    return { active: document.fields.active?.booleanValue === true, plan: document.fields.plan?.stringValue || null };
  }

  function projectionFields(value) {
    if (!value || value.schemaVersion !== 1 || typeof value.active !== 'boolean' || ![null, 'monthly', 'annual', 'lifetime'].includes(value.plan)
      || !whole(value.currentPeriodEnd) || !whole(value.updatedAt) || !/^[a-z_]{1,80}$/.test(value.status || '') || !/^[a-z_]{1,80}$/.test(value.reason || '')) fail('firebase_invalid_projection');
    const fields = {
      schemaVersion: { integerValue: '1' }, active: { booleanValue: value.active },
      plan: value.plan === null ? { nullValue: null } : { stringValue: value.plan },
      currentPeriodEnd: { integerValue: String(value.currentPeriodEnd) }, updatedAt: { integerValue: String(value.updatedAt) },
      status: { stringValue: value.status }, reason: { stringValue: value.reason },
    };
    for (const [name, prefix] of [['customerId', 'cus_'], ['subscriptionId', 'sub_'], ['checkoutSessionId', 'cs_'], ['paymentIntentId', 'pi_']]) {
      if (value[name] !== undefined && !(new RegExp(`^${prefix}${name === 'checkoutSessionId' ? '(?:test_|live_)?' : ''}[A-Za-z0-9]+$`)).test(value[name])) fail('firebase_invalid_projection');
      fields[name] = value[name] === undefined ? { nullValue: null } : { stringValue: value[name] };
    }
    if (value.active && value.plan === 'lifetime' && (!value.customerId || !value.checkoutSessionId || !value.paymentIntentId || value.currentPeriodEnd !== 0 || value.reason !== 'paid_lifetime')) fail('firebase_invalid_projection');
    if (value.active && value.plan !== 'lifetime' && (!value.plan || !value.customerId || !value.subscriptionId || value.currentPeriodEnd <= value.updatedAt || value.reason !== 'paid_period')) fail('firebase_invalid_projection');
    return fields;
  }

  async function projectSubscription(uid, projection) {
    const operation = startOperation();
    if (!UID.test(uid || '')) fail('firebase_invalid_uid');
    const initial = projectionFields(projection);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await readDocument('entitlements', uid, operation);
      const old = before?.fields || {};
      if ((old.plan?.stringValue === 'lifetime' && !/^pi_[A-Za-z0-9]+$/.test(old.paymentIntentId?.stringValue || '')) || (old.adminBlocked && typeof old.adminBlocked.booleanValue !== 'boolean')) fail('firebase_projection_conflict');
      if (old.updatedAt && (!/^\d{1,16}$/.test(old.updatedAt.integerValue || '') || Number(old.updatedAt.integerValue) > projection.updatedAt)) fail('firebase_projection_stale');
      const fields = structuredClone(initial);
      if (old.adminBlocked?.booleanValue === true) {
        fields.active = { booleanValue: false }; fields.currentPeriodEnd = { integerValue: '0' };
        fields.reason = { stringValue: 'admin_blocked' }; fields.status = { stringValue: 'blocked' };
      }
      const write = { update: { name: documentName('entitlements', uid), fields },
        updateMask: { fieldPaths: Object.keys(fields) },
        currentDocument: before ? { updateTime: before.updateTime } : { exists: false } };
      try {
        const { data } = await authorized(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }),
        }, false, operation);
        if (data?.writeResults?.length !== 1 || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(data.writeResults[0]?.updateTime || '')) fail('firebase_projection_not_confirmed');
        return { written: true, adminBlocked: old.adminBlocked?.booleanValue === true };
      } catch (error) {
        const conflict = [409, 412].includes(error.httpStatus) || (error.httpStatus === 400 && error.providerCode === 'FAILED_PRECONDITION');
        if (!conflict || attempt === 2) throw error;
      }
    }
  }
  return { auth: { verifyIdToken }, legacyEntitlement, entitlements: { projectSubscription } };
}
