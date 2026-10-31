/** Read-only provider readiness. No synthesis, billing writes, keys or signups.
 * OAuth access tokens remain in process; reports contain no credentials.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const AUDIO_PROJECT = 'minimalpairs-audio-20260928';
export const AUDIO_PROJECT_NUMBER = '945328995696';
const directory = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(directory, '../../app');
const require = createRequire(import.meta.url);
const locales = ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-US', 'it-IT', 'cmn-CN', 'pt-BR', 'ru-RU', 'ja-JP'];
const knownEndpoints = new Set([
  `https://cloudresourcemanager.googleapis.com/v1/projects/${AUDIO_PROJECT}`,
  `https://cloudbilling.googleapis.com/v1/projects/${AUDIO_PROJECT}/billingInfo`,
  `https://serviceusage.googleapis.com/v1/projects/${AUDIO_PROJECT_NUMBER}/services/texttospeech.googleapis.com`,
  'https://cloudbilling.googleapis.com/v1/billingAccounts?pageSize=100',
  'https://texttospeech.googleapis.com/v1/voices',
]);

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) { await reader.cancel(); throw new Error('oversized_response'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/** For the root's already authorized, fixed-project operator only; never log it. */
export async function getGoogleAudioAccessToken() {
  const auth = require(path.join(app, 'node_modules/firebase-tools/lib/auth.js'));
  const api = require(path.join(app, 'node_modules/firebase-tools/lib/api.js'));
  const owner = auth.getProjectDefaultAccount(app);
  if (!owner?.tokens?.refresh_token) throw new Error('google_owner_login_missing');
  // Use the CLI's existing OAuth registration, but do not update its stored tokens.
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: owner.tokens.refresh_token,
      client_id: api.clientId(), client_secret: api.clientSecret(), scope: 'https://www.googleapis.com/auth/cloud-platform' }),
  });
  const payload = await boundedJson(result);
  if (!result.ok || typeof payload.access_token !== 'string' || payload.access_token.length < 20
      || payload.access_token === owner.tokens.refresh_token) throw new Error('google_owner_login_refresh_failed');
  return payload.access_token;
}

async function readGoogle(url, token, quota = false) {
  if (!knownEndpoints.has(url)) throw new Error('endpoint_outside_readiness_scope');
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, ...(quota ? { 'X-Goog-User-Project': AUDIO_PROJECT } : {}) } });
    const data = await boundedJson(response);
    const reasons = (data?.error?.details || []).map(d => d?.reason).filter(v => typeof v === 'string' && /^[A-Z_]{3,80}$/.test(v));
    return { ok: response.ok, httpStatus: response.status, reasons: [...new Set(reasons)], data: response.ok ? data : null };
  } catch { return { ok: false, httpStatus: null, reasons: ['READ_UNAVAILABLE'], data: null }; }
}
const safe = result => ({ ok: result.ok, httpStatus: result.httpStatus, reasons: result.reasons });

export async function runReadiness() {
  const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), mode: 'read-only-readiness', projectId: AUDIO_PROJECT,
    synthesisRequestsSent: 0, billingMutations: 0, credentialValuesPrintedOrSaved: false,
    localProviderCredentialPresence: { cartesia: Boolean(process.env.CARTESIA_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) } };
  let token;
  try { token = await getGoogleAudioAccessToken(); report.googleOwnerOAuthAvailable = true; }
  catch { return { ...report, googleOwnerOAuthAvailable: false, readyForSynthesis: false, blocker: 'Owner OAuth unavailable; sign-in may be required.' }; }
  const [project, billing, service, accounts, voices] = await Promise.all([
    readGoogle(`https://cloudresourcemanager.googleapis.com/v1/projects/${AUDIO_PROJECT}`, token),
    readGoogle(`https://cloudbilling.googleapis.com/v1/projects/${AUDIO_PROJECT}/billingInfo`, token),
    readGoogle(`https://serviceusage.googleapis.com/v1/projects/${AUDIO_PROJECT_NUMBER}/services/texttospeech.googleapis.com`, token),
    readGoogle('https://cloudbilling.googleapis.com/v1/billingAccounts?pageSize=100', token),
    readGoogle('https://texttospeech.googleapis.com/v1/voices', token, true),
  ]);
  const projectMatches = project.data?.projectId === AUDIO_PROJECT && project.data?.projectNumber === AUDIO_PROJECT_NUMBER;
  report.project = { ...safe(project), identityMatches: projectMatches, lifecycleState: projectMatches ? project.data.lifecycleState : null };
  report.billing = { ...safe(billing), billingEnabled: billing.data?.billingEnabled === true,
    linkedAccount: typeof billing.data?.billingAccountName === 'string' && /^billingAccounts\/[A-Z0-9-]+$/.test(billing.data.billingAccountName) ? billing.data.billingAccountName : null };
  report.service = { ...safe(service), state: ['ENABLED', 'DISABLED'].includes(service.data?.state) ? service.data.state : null };
  report.audioNamedBillingAccounts = { ...safe(accounts), furtherPagesExist: Boolean(accounts.data?.nextPageToken),
    matches: (accounts.data?.billingAccounts || []).filter(a => /minimalpairs|audio/i.test(a.displayName || '')).map(a => ({
      name: /^billingAccounts\/[A-Z0-9-]+$/.test(a.name || '') ? a.name : null,
      displayName: String(a.displayName || '').slice(0,120), open: a.open === true,
    })) };
  const catalog = Array.isArray(voices.data?.voices) ? voices.data.voices : [];
  report.voiceCatalog = { ...safe(voices), chirpByLocale: Object.fromEntries(locales.map(locale => [locale,
    catalog.filter(v => Array.isArray(v.languageCodes) && v.languageCodes.includes(locale) && String(v.name).startsWith(locale+'-Chirp3-HD-')).map(v => v.name).sort()])) };
  report.readyForSynthesis = Boolean(projectMatches && project.data.lifecycleState === 'ACTIVE' && report.billing.billingEnabled
    && report.service.state === 'ENABLED' && voices.ok && Object.values(report.voiceCatalog.chirpByLocale).every(v => v.length));
  report.limitation = 'Readiness does not prove synthesis succeeds, billing allowance remains, accent/word correctness, or permission to expand the frozen old adapter selection.';
  return report;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--check') {
    process.stdout.write('Read-only readiness: node readiness.mjs --check\nNo synthesis or configuration changes. Default invocation is inert.\n');
  } else {
    try { process.stdout.write(JSON.stringify(await runReadiness(), null, 2)+'\n'); }
    catch { process.stdout.write(JSON.stringify({ error: 'readiness_failed_without_disclosing_provider_or_credential_details' })+'\n'); process.exitCode = 1; }
  }
}
