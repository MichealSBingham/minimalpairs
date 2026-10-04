import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/entitlements.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const buyer = { user: { id: 'buyer', email: 'buyer@example.invalid', email_verified: true } };
function fixture({ sessions = [buyer], lifetime, subscription, fail = false } = {}) {
  const reads = [];
  const auth = { getDatabase: () => ({}), getSession: async () => sessions.length > 1 ? sessions.shift() : sessions[0] };
  const firestore = { doc: (_db, collection, id) => ({ collection, id }), getDoc: () => { throw Error('Cache-capable read must not be used'); }, getDocFromServer: async ref => { reads.push(ref); if (fail) throw Error('offline'); const data = ref.collection === 'legacyEntitlements' ? lifetime : subscription; return { exists: () => data !== undefined, data: () => data }; } };
  const module = { exports: {} }; new Function('require', 'module', 'exports', compiled)(name => name === './auth' ? auth : firestore, module, module.exports);
  return { check: () => module.exports.getEntitlement({ fresh: true, expectedUserId: 'buyer' }), reads };
}
test('fresh billing check uses server reads and lifetime priority', async () => {
  const f = fixture({ lifetime: { plan: 'lifetime', active: true } }); assert.equal((await f.check()).plan, 'lifetime'); assert.equal(f.reads.length, 1);
  const member = fixture({ subscription: { plan: 'monthly', active: true, currentPeriodEnd: Date.now() / 1000 + 3600 } }); assert.equal((await member.check()).source, 'subscription'); assert.equal(member.reads.length, 2);
});
test('offline server never falls back to a cached grant or missing grant', async () => { await assert.rejects(fixture({ fail: true }).check(), /offline/); });
test('sign-out, account switch, changed email and lost verification reject before exposing either grant', async () => {
  for (const changed of [null, { user: { ...buyer.user, id: 'other' } }, { user: { ...buyer.user, email_verified: false } }, { user: { ...buyer.user, email: 'different@example.invalid' } }]) {
    const duringLifetime = fixture({ sessions: [buyer, changed], lifetime: { plan: 'lifetime', active: true } }); await assert.rejects(duringLifetime.check(), { code: 'app/account-changed' });
    const duringSubscription = fixture({ sessions: [buyer, buyer, changed], subscription: { plan: 'annual', active: true, currentPeriodEnd: Date.now() / 1000 + 3600 } }); await assert.rejects(duringSubscription.check(), { code: 'app/account-changed' });
  }
  const before = fixture({ sessions: [{ user: { ...buyer.user, id: 'other' } }] }); await assert.rejects(before.check(), { code: 'app/account-changed' }); assert.equal(before.reads.length, 0);
});
