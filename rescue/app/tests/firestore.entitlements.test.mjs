import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the real module with only its auth/database boundary replaced. No network.
const source = readFileSync(new URL('../src/lib/entitlements.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client({ session = { user: { id: 'buyer', email: ' Buyer@Example.Invalid ', email_verified: true } }, db = {}, lifetime, subscription, failure } = {}) {
  const reads = [];
  const dependencies = {
    'firebase/firestore': {
      doc: (_db, collection, id) => ({ collection, id }),
      getDoc: async (ref) => {
        reads.push(ref);
        if (failure) throw failure;
        const data = ref.collection === 'legacyEntitlements' ? lifetime : subscription;
        return { exists: () => data !== undefined, data: () => data };
      },
    },
    './auth': { getDatabase: () => db, getSession: async () => session },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected entitlement dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return { getEntitlement: module.exports.getEntitlement, reads };
}

test('entitlements: absent Firebase, signed-out users, missing email and unverified email cannot obtain access', async () => {
  for (const options of [
    { db: null }, { session: null },
    { session: { user: { id: 'buyer', email: '', email_verified: true } } },
    { session: { user: { id: 'buyer', email: 'buyer@example.invalid', email_verified: false } } },
  ]) {
    const subject = client({ ...options, lifetime: { active: true, plan: 'lifetime' } });
    assert.equal(await subject.getEntitlement(), null);
    assert.deepEqual(subject.reads, []);
  }
});
test('entitlements: lifetime buyers receive permanent access without a subscription lookup', async () => {
  const subject = client({ lifetime: { active: true, plan: 'lifetime' }, subscription: { active: false, plan: 'annual' } });
  assert.deepEqual(await subject.getEntitlement(), { active: true, plan: 'lifetime', source: 'legacy-purchase' });
  assert.deepEqual(subject.reads, [{ collection: 'legacyEntitlements', id: 'buyer@example.invalid' }]);
});
test('entitlements: absent and inactive lifetime grants do not confer access', async () => {
  for (const lifetime of [undefined, { active: false, plan: 'lifetime' }, { active: 'true', plan: 'lifetime' }, { active: true, plan: 'annual' }]) {
    const subject = client({ lifetime });
    assert.equal(await subject.getEntitlement(), null);
    assert.deepEqual(subject.reads.at(-1), { collection: 'entitlements', id: 'buyer' });
  }
});
test('entitlements: current monthly and annual subscriptions confer access using seconds', async () => {
  for (const plan of ['monthly', 'annual']) {
    const subject = client({ subscription: { active: true, plan, currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 } });
    assert.deepEqual(await subject.getEntitlement(), { active: true, plan, source: 'subscription' });
  }
});
test('entitlements: canceled, expired, missing-expiry and malformed subscriptions fail closed', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  for (const subscription of [
    { active: false, plan: 'annual', currentPeriodEnd: future },
    { active: true, plan: 'monthly', currentPeriodEnd: Math.floor(Date.now() / 1000) - 1 },
    { active: true, plan: 'monthly' },
    { active: 'true', plan: 'annual', currentPeriodEnd: future },
    { active: true, plan: 'lifetime', currentPeriodEnd: future },
    { active: true, plan: 'annual', currentPeriodEnd: String(future) },
  ]) assert.equal(await client({ subscription }).getEntitlement(), null);
});
test('entitlements: database read errors never fabricate paid access', async () => {
  await assert.rejects(client({ failure: new Error('permission-denied') }).getEntitlement(), /permission-denied/);
});
