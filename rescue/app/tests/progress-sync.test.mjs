import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(file, dependencies = {}, window = undefined) {
  const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, window);
  return module.exports;
}
const data = compile('progress-data');
const sample = (id = 'rounds-1', patch = {}) => ({
  id, mode: 'abx-cross-word', schemaVersion: 2, textHintsUsed: false,
  completedAt: '2026-09-28T12:00:00.000Z', languageId: 'fr', contrastId: 'fr-u-y',
  correct: 11, total: 12, mistakes: [{ pairId: 'fr-u-y-1', word: 'tu', chosenWord: 'roue' }], ...patch,
});
const verified = id => ({ user: { id, email: `${id}@example.invalid`, email_verified: true } });

function client({ account = verified('alice'), remote = [], enabledFor, readFailure, writeFailure, afterRead, storageFailure = false, removeFailure = false } = {}) {
  let signedIn = account;
  const storage = new Map(enabledFor ? [['minimalpairs.account-sync.v1', enabledFor]] : []);
  const rows = new Map(remote.map(record => [record.id, record]));
  const reads = []; const writes = [];
  const write = (ref, value) => {
    if (writeFailure) throw writeFailure;
    assert.equal(ref.parts[1], signedIn?.user.id, 'Writes must stay within the currently authenticated account');
    const existing = rows.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('immutable-session');
    writes.push({ path: ref.parts, value }); rows.set(value.id, value);
  };
  const dependencies = {
    './progress-data': data,
    './auth': { getSession: async () => signedIn, getDatabase: () => ({}) },
    'firebase/firestore': {
      collection: (_db, ...parts) => ({ parts }), doc: (_db, ...parts) => ({ parts }),
      query: (ref, ...constraints) => ({ ...ref, constraints }), orderBy: (...args) => args, limit: n => n,
      getDocsFromServer: async ref => {
        reads.push(ref);
        if (readFailure) throw readFailure;
        const result = { docs: [...rows.values()].map(row => ({ id: row.id, data: () => row })) };
        if (afterRead) signedIn = afterRead(signedIn);
        return result;
      },
      setDoc: async (ref, value) => write(ref, value),
      writeBatch: () => {
        const queued = [];
        return { set: (ref, value) => queued.push({ ref, value }), commit: async () => {
          if (writeFailure) throw writeFailure;
          queued.forEach(({ ref, value }) => write(ref, value));
        } };
      },
    },
  };
  const window = { localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => { if (storageFailure) throw new Error('storage denied'); storage.set(key, value); },
    removeItem: key => { if (removeFailure) throw new Error('storage denied'); storage.delete(key); },
  } };
  return { api: compile('progress-sync', dependencies, window), reads, writes, storage, rows, setAccount: value => { signedIn = value; } };
}

test('progress data rejects old identification, malformed scores, unsafe document IDs and false text flags', () => {
  for (const patch of [
    { mode: 'word-identification' }, { schemaVersion: 1 }, { id: '../someone-else' },
    { correct: 13 }, { correct: -1 }, { total: 0 }, { total: 101 }, { correct: 2.5 },
    { textHintsUsed: 'false' }, { audioCollectionId: '../unknown' }, { completedAt: 'not-a-date' }, { mistakes: ['word'] },
    { mistakes: [{ pairId: 'p', word: 'x'.repeat(121), chosenWord: 'y' }] },
  ]) assert.equal(data.normalizeSession(sample('r', patch)), null, JSON.stringify(patch));
  const valid = data.normalizeSession(sample('r', { admin: true }));
  assert.equal(Object.hasOwn(valid, 'admin'), false);
  assert.equal(data.normalizeSession(sample('r', { textHintsUsed: undefined })).textHintsUsed, undefined);
  assert.equal(data.normalizeSession(sample('r', { audioCollectionId: 'human-fr-u-y-v1' })).audioCollectionId, 'human-fr-u-y-v1');
});

test('merging is deduplicated, ordered, bounded and gives a conflicting cloud ID precedence', () => {
  const local = { sessions: [sample('a'), sample('b', { completedAt: '2026-09-27T12:00:00.000Z' })], nativeLanguage: 'English' };
  const original = structuredClone(local);
  const merged = data.mergeAccountProgress(local, [sample('a', { correct: 10, textHintsUsed: true })]);
  assert.deepEqual(merged.sessions.map(row => row.id), ['b', 'a']);
  assert.equal(merged.sessions[1].correct, 10);
  assert.equal(merged.sessions[1].textHintsUsed, true);
  assert.equal(merged.nativeLanguage, 'English');
  assert.deepEqual(local, original, 'Merging must not overwrite device history');
  assert.equal(data.validSessions(Array.from({ length: 1100 }, (_, i) => sample(`r-${i}`))).length, 1000);
});

test('reading cloud history reports automatic saving without uploading older device sessions', async () => {
  const subject = client({ remote: [sample('remote')] });
  const local = { sessions: [sample('device')] };
  const result = await subject.api.loadAccountProgress(local);
  assert.equal(result.syncEnabled, true);
  assert.equal(result.progress.sessions.length, 2);
  assert.deepEqual(subject.reads[0].parts, ['users', 'alice', 'sessions']);
  assert.equal(subject.writes.length, 0);
  assert.equal(subject.storage.size, 0);
});

test('explicit connection uploads only missing valid sessions and identical repeat does zero writes', async () => {
  const subject = client({ remote: [sample('existing', { correct: 5 })] });
  const local = { sessions: [sample('existing'), sample('new'), sample('old', { mode: 'word-identification' })] };
  const result = await subject.api.connectDeviceHistory(local);
  assert.equal(result.uploaded, 1);
  assert.equal(result.syncEnabled, true);
  assert.equal(result.progress.sessions.find(row => row.id === 'existing').correct, 5);
  assert.deepEqual(subject.writes[0].path, ['users', 'alice', 'sessions', 'new']);
  assert.equal((await subject.api.connectDeviceHistory(local)).uploaded, 0);
  assert.equal(subject.writes.length, 1);
});

test('new sessions save automatically only to the verified current account', async () => {
 for (const account of [null, {user:{id:'alice',email_verified:false}}]) {
  const subject=client({account});assert.equal(await subject.api.saveCompletedSession(sample()),'disabled');assert.equal(subject.writes.length,0);
 }
 const subject=client();assert.equal(await subject.api.saveCompletedSession(sample()),'saved');
 assert.deepEqual(subject.writes[0].path,['users','alice','sessions',sample().id]);
 subject.setAccount(verified('bob'));assert.equal(await subject.api.saveCompletedSession(sample('other')),'saved');
 assert.deepEqual(subject.writes[1].path,['users','bob','sessions','other']);
});

test('account switch during a read prevents upload and never enables the new account', async () => {
  const subject = client({ afterRead: () => verified('bob') });
  await assert.rejects(subject.api.connectDeviceHistory({ sessions: [sample()] }), /account changed/);
  assert.equal(subject.writes.length, 0);
  assert.equal(subject.storage.size, 0);
});

test('read/write failures preserve local progress and never claim synchronization', async () => {
  for (const options of [{ readFailure: new Error('offline') }, { writeFailure: new Error('permission-denied') }]) {
    const subject = client(options);
    const local = { sessions: [sample()] }; const original = structuredClone(local);
    await assert.rejects(subject.api.connectDeviceHistory(local), /offline|permission-denied/);
    assert.deepEqual(local, original);
    assert.equal(subject.storage.size, 0);
  }
});

test('storage refusal distinguishes a confirmed upload from an automatic-sync preference failure', async () => {
  const subject = client({ storageFailure: true });
  await assert.rejects(subject.api.connectDeviceHistory({ sessions: [sample()] }), /history was saved.*cannot remember/);
  assert.equal(subject.writes.length, 1);
  assert.equal(subject.storage.size, 0);
});

test('disconnect affects only the matching account preference and deletes no history', async () => {
  const subject = client({ enabledFor: 'alice', remote: [sample()] });
  subject.api.disconnectDeviceHistory('bob');
  assert.equal(subject.storage.get('minimalpairs.account-sync.v1'), 'alice');
  subject.api.disconnectDeviceHistory('alice');
  assert.equal(subject.storage.size, 0);
  assert.equal(subject.rows.size, 1);
  assert.equal(await subject.api.saveCompletedSession(sample('new')), 'saved');
});

test('a failed opt-out is reported instead of falsely claiming automatic saves are off', () => {
  const subject = client({ enabledFor: 'alice', removeFailure: true });
  assert.throws(() => subject.api.disconnectDeviceHistory('alice'), /could not turn off/);
  assert.equal(subject.storage.get('minimalpairs.account-sync.v1'), 'alice');
});
