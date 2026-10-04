import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const uid = 'verified-fixture-uid';
const id = '55555555-5555-4555-8555-555555555555';
const token = 'synthetic-fixture-token-not-real';
const session = (id = uid, verified = true) => ({ user: { id, email_verified: verified } });
const enabled = { PUBLIC_BILLING_ENABLED: 'true', PUBLIC_BILLING_CHECKOUT_ENABLED: 'true', PUBLIC_BILLING_API_ORIGIN: 'https://billing.example.invalid' };
function fixture(options = {}) {
  const env = { ...enabled, ...options.env };
  const source = readFileSync(new URL('../src/lib/billing-client.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', JSON.stringify(env));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [], sessions = options.sessions || [session(), session()];
  const auth = {
    getFreshVerifiedIdToken: async expected => { calls.push({ kind: 'token', expected }); if (options.identityError) throw options.identityError; return token; },
    getSession: async () => { calls.push({ kind: 'session' }); return sessions.shift() ?? null; },
  };
  const transport = async (url, init) => {
    calls.push({ kind: 'http', url, init });
    if (options.fetch) return options.fetch(url, init);
    return Response.json(options.result || { url: `https://${url.endsWith('/portal') ? 'billing' : 'checkout'}.stripe.com/fixture` }, { status: options.status || 200 });
  };
  const module = { exports: {} };
  const timer = options.shortTimeout ? ((fn) => setTimeout(fn, 10)) : setTimeout;
  new Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'clearTimeout', compiled)(name => { assert.equal(name, './auth'); return auth; }, module, module.exports, transport, timer, clearTimeout);
  return { api: module.exports, calls };
}
const checkout = subject => subject.api.createMembershipCheckout('monthly', id, uid);

test('billing client is inert on import and rejects omitted/nonliteral switches before identity or HTTP', async () => {
  const f = fixture(); assert.deepEqual(f.calls, []);
  for (const flag of [undefined, 'false', 'TRUE', true, '1']) {
    const f = fixture({ env: { PUBLIC_BILLING_ENABLED: flag } });
    assert.equal(f.api.billingAvailable, false);
    await assert.rejects(checkout(f), { code: 'billing/unavailable' });
    await assert.rejects(f.api.createMembershipPortal(uid), { code: 'billing/unavailable' });
    assert.deepEqual(f.calls, []);
  }
});

test('only a build-configured HTTPS origin may receive a token', async () => {
  for (const origin of ['', 'http://billing.example.invalid', 'https://billing.example.invalid/', 'https://billing.example.invalid/api', 'https://user:pass@billing.example.invalid', 'https://billing.example.invalid?token=bad', 'https://billing.example.invalid#fragment']) {
    const f = fixture({ env: { PUBLIC_BILLING_API_ORIGIN: origin } });
    await assert.rejects(checkout(f), { code: 'billing/unavailable' }); assert.deepEqual(f.calls, []);
  }
});

test('checkout sends only plan/request ID plus a fresh bearer token and never a UID/email/price', async () => {
  const f = fixture(); assert.equal(await checkout(f), 'https://checkout.stripe.com/fixture');
  assert.equal(f.calls[0].expected, uid);
  const call = f.calls.find(c => c.kind === 'http');
  assert.equal(call.url, 'https://billing.example.invalid/billing/checkout');
  assert.equal(call.init.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(call.init.body), { plan: 'monthly', requestId: id });
  for (const [key, value] of Object.entries({ method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })) assert.equal(call.init[key], value);
  assert.ok(!call.url.includes(token));
  assert.equal(f.calls.filter(c => c.kind === 'http').length, 1);
});

test('pausing checkout leaves explicit portal access possible and passes an empty body', async () => {
  const f = fixture({ env: { PUBLIC_BILLING_CHECKOUT_ENABLED: 'false' } });
  await assert.rejects(checkout(f), { code: 'billing/unavailable' }); assert.deepEqual(f.calls, []);
  assert.equal(await f.api.createMembershipPortal(uid), 'https://billing.stripe.com/fixture');
  assert.deepEqual(JSON.parse(f.calls.find(c => c.kind === 'http').init.body), {});
});

test('invalid plans and request identifiers cause zero identity or network calls', async () => {
  for (const [plan, requestId] of [['weekly', id], ['monthly', 'untrusted-id'], ['annual', '../path']]) {
    const f = fixture(); await assert.rejects(f.api.createMembershipCheckout(plan, requestId, uid), { code: 'billing/invalid-request' }); assert.deepEqual(f.calls, []);
  }
});

test('changed, signed-out or unverified accounts cannot send or receive a stale billing destination', async () => {
  for (const changed of [session('other'), session(uid, false), null]) {
    const before = fixture({ sessions: [changed] });
    await assert.rejects(checkout(before), { code: 'app/account-changed' });
    assert.ok(!before.calls.some(c => c.kind === 'http'));
    const after = fixture({ sessions: [session(), changed] });
    await assert.rejects(checkout(after), { code: 'app/account-changed' });
    assert.equal(after.calls.filter(c => c.kind === 'http').length, 1);
  }
});

test('fresh identity failure prevents all billing HTTP requests', async () => {
  const f = fixture({ identityError: Object.assign(new Error('Verify first'), { code: 'app/verification-required' }) });
  await assert.rejects(checkout(f), { code: 'app/verification-required' });
  assert.ok(!f.calls.some(c => c.kind === 'http'));
});

test('provider error bodies cannot leak messages and lifetime/no-account states have useful responses', async () => {
  for (const code of ['lifetime_access_already_covers_membership', 'no_billing_account', 'existing_subscription_use_portal']) {
    const f = fixture({ status: 409, result: { error: code, message: 'private provider detail' } });
    await assert.rejects(checkout(f), error => error.code === `billing/${code}` && !error.message.includes('private'));
  }
  for (const code of ['__proto__', 'toString', 'unknown_private_detail']) {
    const f = fixture({ status: 503, result: { error: code, message: token } });
    await assert.rejects(checkout(f), error => error.code === 'billing/unavailable' && !error.message.includes(token) && !error.message.includes('Object'));
  }
});

test('only the exact expected Stripe HTTPS host is returned for each action', async () => {
  for (const url of ['https://checkout.stripe.com.attacker.invalid/x', 'https://attacker.invalid/checkout.stripe.com', 'http://checkout.stripe.com/x', 'https://user@checkout.stripe.com/x', 'https://checkout.stripe.com:444/x', 'https://billing.stripe.com/x', 'javascript:alert(1)', '//checkout.stripe.com/x']) {
    const f = fixture({ result: { url } }); await assert.rejects(checkout(f), { code: 'billing/unavailable' });
  }
  const portal = fixture({ result: { url: 'https://checkout.stripe.com/x' } });
  await assert.rejects(portal.api.createMembershipPortal(uid), { code: 'billing/unavailable' });
});

test('malformed or oversized response bodies cannot produce a destination', async () => {
  for (const body of ['not-json', JSON.stringify({ url: 'https://checkout.stripe.com/x', extra: 'x'.repeat(9000) }), '{}']) {
    const f = fixture({ fetch: async () => new Response(body) }); await assert.rejects(checkout(f), { code: 'billing/unavailable' });
  }
});

test('timeout aborts the request and does not automatically create another checkout', async () => {
  let aborted = false;
  const f = fixture({ shortTimeout: true, fetch: async (_url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture transport detail')); }, { once: true })) });
  await assert.rejects(checkout(f), { code: 'billing/unavailable' });
  assert.equal(aborted, true); assert.equal(f.calls.filter(c => c.kind === 'http').length, 1);
});

test('timeout cancels a stalled response body instead of waiting forever', async () => {
  let cancelled = false;
  const f = fixture({ shortTimeout: true, fetch: async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } })) });
  await assert.rejects(checkout(f), { code: 'billing/unavailable' }); assert.equal(cancelled, true);
});

test('explicit status checks use a fresh account, empty body, and remain available when new sales are paused', async () => {
  for (const result of [{ state: 'none' }, { state: 'existing_subscription' }, { state: 'lifetime' },
    { state: 'open', plan: 'annual', requestId: id, createdAt: Math.floor(Date.now() / 1000) }]) {
    const f = fixture({ result, env: { PUBLIC_BILLING_CHECKOUT_ENABLED: 'false' } });
    assert.deepEqual(await f.api.getMembershipCheckoutStatus(uid), result);
    const http = f.calls.find(c => c.kind === 'http');
    assert.equal(http.url, 'https://billing.example.invalid/billing/checkout-status');
    assert.deepEqual(JSON.parse(http.init.body), {});
    assert.equal(f.calls.filter(c => c.kind === 'http').length, 1);
  }
});

test('malformed status cannot authorize discarding a browser checkout note', async () => {
  for (const result of [{ state: 'expired' }, { state: ['none'] }, { state: 'none', uid: 'other' }, { state: 'none', url: 'https://checkout.stripe.com/x' },
    { state: 'pending', plan: 'monthly', requestId: id },
    { state: 'open', plan: ['monthly'], requestId: id, createdAt: 100 },
    { state: 'open', plan: 'monthly', requestId: 'invalid', createdAt: 100 },
    { state: 'open', plan: 'monthly', requestId: id, createdAt: Date.now() }]) {
    const f = fixture({ result });
    await assert.rejects(f.api.getMembershipCheckoutStatus(uid), { code: 'billing/unavailable' });
  }
});

test('status failure, disabled service and changed identity never return a clearing instruction', async () => {
  const disabled = fixture({ env: { PUBLIC_BILLING_ENABLED: 'false' } });
  await assert.rejects(disabled.api.getMembershipCheckoutStatus(uid), { code: 'billing/unavailable' }); assert.equal(disabled.calls.length, 0);
  const switched = fixture({ result: { state: 'none' }, sessions: [session(), session('other')] });
  await assert.rejects(switched.api.getMembershipCheckoutStatus(uid), { code: 'app/account-changed' });
  const failed = fixture({ result: { error: 'private_server_detail' }, status: 503 });
  await assert.rejects(failed.api.getMembershipCheckoutStatus(uid), { code: 'billing/unavailable' });
});


test('lifetime checkout sends a one-time plan request through the same verified identity path',async()=>{
 const f=fixture();
 await f.api.createMembershipCheckout('lifetime',id,uid);
 assert.equal(JSON.parse(f.calls.find(c=>c.kind==='http').init.body).plan,'lifetime');
});
