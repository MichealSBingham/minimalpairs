import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/lib/billing-checkout-state.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }; new Function('module', 'exports', source)(module, module.exports);
const api = module.exports;
const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
function store() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }
test('checkout request survives reload and long uncertainty with the same UID/plan identity', () => {
  const storage = store(); const record = api.reserveCheckout(storage, 'buyer', 'monthly', () => first, 1000);
  assert.deepEqual(api.reserveCheckout(storage, 'buyer', 'monthly', () => second, 999999999), record);
  assert.equal(api.readPendingCheckout(storage, 'buyer').requestId, first);
  assert.throws(() => api.reserveCheckout(storage, 'buyer', 'annual', () => second), /other plan/);
});
test('different accounts cannot reuse, retire or read each other’s pending checkout', () => {
  const storage = store(); api.reserveCheckout(storage, 'buyer-a', 'monthly', () => first);
  assert.equal(api.readPendingCheckout(storage, 'buyer-b'), null);
  api.reserveCheckout(storage, 'buyer-b', 'annual', () => second); api.clearConfirmedCheckout(storage, 'buyer-b');
  assert.equal(api.readPendingCheckout(storage, 'buyer-a').requestId, first);
});
test('broken, mismatched or inaccessible storage fails closed instead of replacing uncertain checkout', () => {
  for (const raw of ['{', '{}', JSON.stringify({ version: 1, uid: 'other', plan: 'monthly', requestId: first, createdAt: 100 })]) {
    const storage = store(); storage.setItem(api.checkoutStorageKey('buyer'), raw);
    assert.throws(() => api.reserveCheckout(storage, 'buyer', 'monthly', () => second), /remember/);
    assert.equal(storage.getItem(api.checkoutStorageKey('buyer')), raw);
  }
  for (const storage of [{ getItem() { throw Error(); } }, { getItem: () => null, setItem() {} }]) assert.throws(() => api.reserveCheckout(storage, 'buyer', 'monthly', () => first), /remember/);
});
test('only explicit confirmed retirement permits a new local request', () => {
  const storage = store(); api.reserveCheckout(storage, 'buyer', 'monthly', () => first); api.clearConfirmedCheckout(storage, 'buyer');
  assert.equal(api.reserveCheckout(storage, 'buyer', 'annual', () => second).requestId, second);
  assert.throws(() => api.clearConfirmedCheckout({ getItem: () => 'still present', removeItem() {} }, 'buyer'), /remember/);
});
test('unavailable or occupied browser lock never runs the billing action', async () => {
  let calls = 0; const action = async () => ++calls;
  await assert.rejects(api.withCheckoutLock(undefined, 'buyer', action), /current browser/);
  await assert.rejects(api.withCheckoutLock({ request: async (_name, options, callback) => { assert.equal(options.ifAvailable, true); return callback(null); } }, 'buyer', action), /another tab/);
  assert.equal(calls, 0);
  assert.equal(await api.withCheckoutLock({ request: async (_name, _options, callback) => callback({}) }, 'buyer', action), 1);
});

test('a server-owned checkout from another device replaces only the verified account local note', () => {
  const storage = store();
  api.reserveCheckout(storage, 'buyer', 'monthly', () => first, 1000);
  api.reserveCheckout(storage, 'other', 'monthly', () => first, 1000);
  const next = api.adoptServerCheckout(storage, 'buyer', { state: 'open', plan: 'annual', requestId: second, createdAt: 200 });
  assert.equal(next.requestId, second); assert.equal(next.createdAt, 200000);
  assert.equal(api.reserveCheckout(storage, 'buyer', 'annual', () => first).requestId, second);
  assert.equal(api.readPendingCheckout(storage, 'other').requestId, first);
  assert.throws(() => api.adoptServerCheckout(storage, 'buyer', { state: 'none', plan: 'annual', requestId: first, createdAt: 200 }), /remember/);
  assert.equal(api.readPendingCheckout(storage, 'buyer').requestId, second);
});
