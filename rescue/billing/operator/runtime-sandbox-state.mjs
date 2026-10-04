import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = code => { throw new Error(code); };
const owned = info => info.uid === process.getuid?.() && (info.mode & 0o077) === 0;
export function privateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || !owned(info)) fail('sandbox_private_directory_unsafe');
}
export function privateJson(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || !owned(info) || info.nlink !== 1 || info.size > 100000) fail('sandbox_private_file_unsafe');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

/** One invocation at a time; a crashed lock is never silently stolen. */
export function lockRuntimeState(directory) {
  privateDirectory(directory);
  const filename = path.join(directory, 'runtime-sandbox-identity.json');
  const lockname = path.join(directory, 'runtime-sandbox-identity.lock');
  const owner = { invocation: randomUUID(), pid: process.pid, startedAt: Date.now() };
  let fd;
  try { fd = fs.openSync(lockname, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('sandbox_operator_locked'); throw error; }
  fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd);
  const stat = fs.fstatSync(fd);
  const assertOwned = () => {
    const current = fs.lstatSync(lockname);
    if (current.ino !== stat.ino || current.dev !== stat.dev || privateJson(lockname).invocation !== owner.invocation) fail('sandbox_lock_ownership_changed');
  };
  let runId;
  return {
    read() {
      assertOwned();
      if (!fs.existsSync(filename)) return null;
      const state = privateJson(filename); runId = state.runId; return state;
    },
    save(state) {
      assertOwned();
      if (fs.existsSync(filename)) {
        if (!runId || privateJson(filename).runId !== runId || state.runId !== runId) fail('sandbox_checkpoint_ownership_changed');
      } else if (runId) fail('sandbox_checkpoint_missing');
      const temporary = `${filename}.${owner.invocation}.tmp`;
      const write = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(write, JSON.stringify(state)); fs.fsyncSync(write); fs.closeSync(write);
        assertOwned();
        if (runId && privateJson(filename).runId !== runId) fail('sandbox_checkpoint_ownership_changed');
        if (!runId) { fs.linkSync(temporary, filename); fs.unlinkSync(temporary); }
        else fs.renameSync(temporary, filename);
        runId = state.runId;
        const dirfd = fs.openSync(directory, 'r'); try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); }
      } finally { try { fs.closeSync(write); } catch {} fs.rmSync(temporary, { force: true }); }
    },
    release() { try { assertOwned(); fs.unlinkSync(lockname); } finally { fs.closeSync(fd); } },
  };
}
