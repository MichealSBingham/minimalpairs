import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import ts from 'typescript';

const host = process.env.FIRESTORE_EMULATOR_HOST;
let env;
function loadModule(name, dependencies, window) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, window);
  return module.exports;
}
const progressData = loadModule('progress-data', {}, undefined);
const session = (id, patch = {}) => ({
  id, mode: 'abx-cross-word', schemaVersion: 2, textHintsUsed: false, audioCollectionId: 'qwen-starter-v1',
  completedAt: '2026-09-28T12:00:00.000Z', languageId: 'fr', contrastId: 'fr-u-y',
  correct: 12, total: 12, mistakes: [], ...patch,
});
function device(uid) {
  const db = env.authenticatedContext(uid, { email: `${uid}@example.invalid`, email_verified: true }).firestore();
  const store = new Map();
  const window = { localStorage: {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  } };
  const api = loadModule('progress-sync', {
    'firebase/firestore': firestore,
    './progress-data': progressData,
    './auth': { getDatabase: () => db, getSession: async () => ({ user: { id: uid, email_verified: true } }) },
  }, window);
  return { api, db, store };
}

describe('real Firestore SDK progress synchronization across isolated devices', { skip: !host && 'Run with the local Firestore emulator' }, () => {
  before(async () => {
    assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
    const [hostname, port] = host.split(':');
    firestore.setLogLevel('silent');
    env = await initializeTestEnvironment({ projectId: 'demo-minimalpairs-progress', firestore: {
      host: hostname, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    } });
    await env.clearFirestore();
  });
  after(async () => { if (env) await env.cleanup(); });

  it('saves on one device and reads on another without uploading on sign-in', async () => {
    const first = device('learner'); const second = device('learner');
    assert.equal((await first.api.connectDeviceHistory({ sessions: [session('from-first')] })).uploaded, 1);
    const read = await second.api.loadAccountProgress({ sessions: [] });
    assert.deepEqual(read.progress.sessions.map(row => row.id), ['from-first']);
    assert.equal(read.syncEnabled, false);
    assert.equal(await second.api.saveCompletedSession(session('not-opted-in')), 'disabled');
    assert.equal((await second.api.connectDeviceHistory({ sessions: [session('from-second', { textHintsUsed: true })] })).uploaded, 1);
    const merged = await first.api.loadAccountProgress({ sessions: [session('from-first')] });
    assert.equal(merged.progress.sessions.length, 2);
    assert.equal(merged.progress.sessions.find(row => row.id === 'from-second').textHintsUsed, true);
    assert.equal((await first.api.connectDeviceHistory({ sessions: [session('from-first')] })).uploaded, 0);
    assert.equal(await first.api.saveCompletedSession(session('later')), 'saved');
    assert.equal((await second.api.loadAccountProgress({ sessions: [] })).progress.sessions.length, 3);
    assert.equal((await device('different-learner').api.loadAccountProgress({ sessions: [] })).progress.sessions.length, 0);
  });

  it('real rules reject conflicting result replacement and keep the original source and score', async () => {
    const current = device('immutable-learner');
    const original = session('stable-result', { audioCollectionId: 'human-fr-u-y-v1' });
    await current.api.connectDeviceHistory({ sessions: [original] });
    await assert.rejects(current.api.saveCompletedSession({ ...original, correct: 0, audioCollectionId: 'qwen-starter-v1' }));
    const saved = (await current.api.loadAccountProgress({ sessions: [] })).progress.sessions[0];
    assert.equal(saved.correct, 12);
    assert.equal(saved.audioCollectionId, 'human-fr-u-y-v1');
  });
});
