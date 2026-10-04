import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export function claimProbeCheckpoint(filename, initial) {
  const runId = randomUUID();
  const encode = state => JSON.stringify({ ...state, runId });
  try { fs.writeFileSync(filename, encode(initial), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('pending_probe_requires_cleanup_review');
    throw error;
  }
  const verifyOwner = () => {
    if (JSON.parse(fs.readFileSync(filename, 'utf8')).runId !== runId) throw new Error('probe_checkpoint_ownership_changed');
  };
  return {
    update(state) {
      verifyOwner();
      const temporary = `${filename}.${runId}.tmp`;
      fs.writeFileSync(temporary, encode(state), { flag: 'wx', mode: 0o600 });
      try { verifyOwner(); fs.renameSync(temporary, filename); }
      finally { fs.rmSync(temporary, { force: true }); }
    },
    release() { verifyOwner(); fs.unlinkSync(filename); },
  };
}

export function isSandboxProbeKey(name, project, email, uniqueId) {
  if (project !== 'minimalpairs-billing-sandbox'
    || email !== `minimalpairs-billing@${project}.iam.gserviceaccount.com`
    || !/^\d{1,30}$/.test(uniqueId || '') || typeof name !== 'string') return false;
  const parts = name.split('/');
  return parts.length === 6 && parts[0] === 'projects' && parts[1] === project
    && parts[2] === 'serviceAccounts' && [email, uniqueId].includes(parts[3])
    && parts[4] === 'keys' && /^[A-Za-z0-9_-]{1,200}$/.test(parts[5]);
}
