import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimProbeCheckpoint, isSandboxProbeKey } from './sandbox-probe-state.mjs';

test('a second or resumed probe cannot replace an active cleanup record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-probe-state-'));
  const file = path.join(directory, 'pending.json');
  try {
    const first = claimProbeCheckpoint(file, { stage: 'before-key' });
    assert.throws(() => claimProbeCheckpoint(file, { stage: 'other-run' }), /pending_probe/);
    first.update({ stage: 'key-created', key: 'synthetic-resource' });
    assert.throws(() => claimProbeCheckpoint(file, {}), /pending_probe/);
    assert.equal(JSON.parse(fs.readFileSync(file)).key, 'synthetic-resource');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    first.release();
    claimProbeCheckpoint(file, { stage: 'new-run' }).release();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a previous owner cannot update or remove a replacement checkpoint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-probe-owner-'));
  const file = path.join(directory, 'pending.json');
  try {
    const first = claimProbeCheckpoint(file, {});
    fs.unlinkSync(file);
    const next = claimProbeCheckpoint(file, { keep: true });
    assert.throws(() => first.update({}), /ownership_changed/);
    assert.throws(() => first.release(), /ownership_changed/);
    assert.equal(JSON.parse(fs.readFileSync(file)).keep, true);
    next.release();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cleanup authority excludes foreign projects, service accounts and malformed key names', () => {
  const project = 'minimalpairs-billing-sandbox';
  const email = `minimalpairs-billing@${project}.iam.gserviceaccount.com`;
  const id = '123456789';
  const key = `projects/${project}/serviceAccounts/${id}/keys/abc123`;
  assert.ok(isSandboxProbeKey(key, project, email, id));
  assert.ok(isSandboxProbeKey(key.replace(id, email), project, email, id));
  for (const bad of [key.replace(project, 'minimalpairs'), key.replace(id, '987654321'),
    key.replace('abc123', '..'), `${key}/extra`, undefined]) {
    assert.equal(isSandboxProbeKey(bad, project, email, id), false);
  }
});
