import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lockRuntimeState, privateDirectory, privateJson } from './runtime-sandbox-state.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-sandbox-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'runtime-sandbox-identity.json'), lock: path.join(directory, 'runtime-sandbox-identity.lock') };
}

test('checkpoint creates and atomically replaces an owned private file', t => {
  const f = fixture(t); const store = lockRuntimeState(f.directory);
  assert.equal(store.read(), null);
  const state = { runId: randomUUID(), phase: 'first' }; store.save(state);
  const initial = fs.statSync(f.file); store.save({ ...state, phase: 'second' });
  assert.equal(privateJson(f.file).phase, 'second'); assert.notEqual(fs.statSync(f.file).ino, initial.ino);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.file).nlink, 1); store.release(); assert.equal(fs.existsSync(f.lock), false);
  const next = lockRuntimeState(f.directory); assert.equal(next.read().runId, state.runId); next.release();
  assert.equal(fs.readdirSync(f.directory).filter(name => name.endsWith('.tmp')).length, 0);
});

test('live and abandoned locks are never silently stolen', t => {
  const f = fixture(t); const store = lockRuntimeState(f.directory);
  assert.throws(() => lockRuntimeState(f.directory), /sandbox_operator_locked/); store.release();
  fs.writeFileSync(f.lock, JSON.stringify({ invocation: randomUUID(), pid: 99999999, startedAt: 1 }), { mode: 0o600 });
  assert.throws(() => lockRuntimeState(f.directory), /sandbox_operator_locked/); assert.ok(fs.existsSync(f.lock));
});

test('a replaced checkpoint cannot be overwritten by its former owner', t => {
  const f = fixture(t); const store = lockRuntimeState(f.directory); store.read();
  const state = { runId: randomUUID() }; store.save(state);
  const replacement = { runId: randomUUID(), keep: true }; fs.writeFileSync(f.file, JSON.stringify(replacement));
  assert.throws(() => store.save({ ...state, keep: false }), /sandbox_checkpoint_ownership_changed/);
  assert.deepEqual(privateJson(f.file), replacement); store.release();
});

test('a removed checkpoint is not recreated by an older invocation', t => {
  const f = fixture(t); const store = lockRuntimeState(f.directory); store.read();
  const state = { runId: randomUUID() }; store.save(state); fs.unlinkSync(f.file);
  assert.throws(() => store.save(state), /sandbox_checkpoint_missing/); assert.equal(fs.existsSync(f.file), false); store.release();
});

test('a replaced lock prevents writes and its removal by the old invocation', t => {
  const f = fixture(t); const store = lockRuntimeState(f.directory); store.read();
  fs.renameSync(f.lock, `${f.lock}.old`);
  fs.writeFileSync(f.lock, JSON.stringify({ invocation: randomUUID(), keep: true }), { mode: 0o600 });
  assert.throws(() => store.save({ runId: randomUUID() }), /sandbox_lock_ownership_changed/);
  assert.throws(() => store.release(), /sandbox_lock_ownership_changed/);
  assert.equal(privateJson(f.lock).keep, true); assert.equal(fs.existsSync(f.file), false);
});

test('private reads reject broad permissions, symlinks, hard links and oversized data', t => {
  const f = fixture(t); fs.writeFileSync(f.file, '{}', { mode: 0o644 });
  assert.throws(() => privateJson(f.file), /sandbox_private_file_unsafe/);
  fs.chmodSync(f.file, 0o600); fs.symlinkSync(f.file, `${f.file}.symlink`);
  assert.throws(() => privateJson(`${f.file}.symlink`));
  fs.linkSync(f.file, `${f.file}.hardlink`); assert.throws(() => privateJson(f.file), /sandbox_private_file_unsafe/);
  fs.unlinkSync(`${f.file}.hardlink`); fs.writeFileSync(f.file, ' '.repeat(100001));
  assert.throws(() => privateJson(f.file), /sandbox_private_file_unsafe/);
});

test('unsafe or symlinked directories cannot hold checkpoints', t => {
  const f = fixture(t); const child = path.join(f.directory, 'private');
  privateDirectory(child); assert.equal(fs.statSync(child).mode & 0o777, 0o700);
  fs.chmodSync(child, 0o755); assert.throws(() => lockRuntimeState(child), /sandbox_private_directory_unsafe/);
  fs.chmodSync(child, 0o700); const link = path.join(f.directory, 'link'); fs.symlinkSync(child, link);
  assert.throws(() => lockRuntimeState(link), /sandbox_private_directory_unsafe/);
});
