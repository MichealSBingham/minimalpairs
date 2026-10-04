// Temporary isolated diagnostics entry. No public debug route, user identifiers,
// tokens, request bodies, URLs or provider messages are logged.
import worker, { BillingLedger as StandardBillingLedger } from '../runtime/worker.mjs';
import { createSandboxFirebaseAdapter } from '../providers/firebase.mjs';
import { decodeJwt } from 'jose';
export class BillingLedger extends StandardBillingLedger {
  createExternalPorts() {
    if (this.config.expectedLivemode !== false || this.env.FIREBASE_PROJECT_ID !== 'minimalpairs-billing-sandbox') throw new Error('diagnostic_scope_invalid');
    const ports = super.createExternalPorts();
    const firebase = createSandboxFirebaseAdapter(this.env, { expectedLivemode: false, getOperationContext: () => this.getOperationContext(),
      fetchImpl: async (url, init) => {
        const host = new URL(url).hostname;
        const phase = host === 'oauth2.googleapis.com' ? 'oauth' : host === 'identitytoolkit.googleapis.com' ? 'account_lookup'
          : host === 'www.googleapis.com' ? 'certificates' : host === 'firestore.googleapis.com' ? 'firestore' : 'unexpected';
        try { const response = await fetch(url, init); console.log(JSON.stringify({ diagnostic: 'sandbox_provider', phase, httpStatus: response.status })); return response; }
        catch (error) { console.log(JSON.stringify({ diagnostic: 'sandbox_provider', phase, transportFailed: true,
          exceptionType: ['TypeError', 'Error', 'AbortError', 'DOMException'].includes(error?.name) ? error.name : 'other',
          abort: /abort/i.test(error?.message || ''), redirect: /redirect/i.test(error?.message || ''),
          context: /context|different request|outside.*request|I\/O/i.test(error?.message || ''),
          illegalInvocation: /illegal invocation/i.test(error?.message || ''),
          signal: /signal/i.test(error?.message || ''), network: /network|connection|DNS|TLS/i.test(error?.message || ''),
          unsupported: /not supported|unsupported|not implemented/i.test(error?.message || '') })); throw new Error('firebase_request_failed'); }
      } });
    return { ...ports, ...firebase, auth: { verifyIdToken: async token => {
      try { const payload = decodeJwt(token); console.log(JSON.stringify({ diagnostic: 'sandbox_token_age', issuedSecondsAgo: Math.floor(Date.now()/1000) - payload.iat,
        expiresInSeconds: payload.exp - Math.floor(Date.now()/1000) })); } catch {}
      try { const result = await firebase.auth.verifyIdToken(token); console.log(JSON.stringify({ diagnostic: 'sandbox_auth', passed: true })); return result; }
      catch { console.log(JSON.stringify({ diagnostic: 'sandbox_auth', passed: false })); throw new Error('firebase_identity_unavailable'); }
    } } };
  }
}
export default worker;
