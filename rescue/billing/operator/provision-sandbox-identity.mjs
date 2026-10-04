import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Local operator only. Never import this file into the Worker or browser app.
const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const project = 'minimalpairs-billing-sandbox';
const accountId = 'minimalpairs-billing';
const email = `${accountId}@${project}.iam.gserviceaccount.com`;
const member = `serviceAccount:${email}`;
const roleName = `projects/${project}/roles/minimalpairsBilling`;
const permissions = ['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update', 'firebaseauth.users.get'];
const roleUrl = `https://iam.googleapis.com/v1/${roleName}`;
const accountUrl = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}`;
const policyUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
const apply = process.argv.length === 3 && process.argv[2] === '--apply';
if (process.argv.length > 2 && !apply) throw new Error('Only --apply is supported; the default is read-only.');

const fail = code => { throw new Error(code); };
function checkRole(role) {
  if (role.name !== roleName || role.deleted || role.stage !== 'GA'
    || JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify(permissions)) fail('existing_role_requires_review');
}
function checkAccount(account) {
  if (account.email !== email || account.projectId !== project || account.disabled === true) fail('existing_identity_requires_review');
}
function hasBinding(policy) {
  return (policy.bindings || []).some(binding => binding.role === roleName && !binding.condition && binding.members?.includes(member));
}

try {
  const auth = require(path.resolve(directory, '../../app/node_modules/firebase-tools/lib/auth.js'));
  const owner = auth.getProjectDefaultAccount(path.resolve(directory, '../../app'));
  if (!owner?.tokens?.refresh_token) fail('operator_login_required');
  const access = await auth.getAccessToken(owner.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  if (!access.access_token) fail('operator_login_required');
  async function request(url, method = 'GET', body, missingAllowed = false) {
    if (!['iam.googleapis.com', 'cloudresourcemanager.googleapis.com'].includes(new URL(url).hostname)) fail('destination_not_allowed');
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (response.status === 404 && missingAllowed) { await response.body?.cancel(); return null; }
    const data = await response.json();
    if (!response.ok) fail(`google_request_${response.status}_${/^[A-Z_]+$/.test(data.error?.status || '') ? data.error.status : 'FAILED'}`);
    return data;
  }
  const [existingAccount, existingRole, before] = await Promise.all([
    request(accountUrl, 'GET', undefined, true), request(roleUrl, 'GET', undefined, true),
    request(`${policyUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } }),
  ]);
  if (existingAccount) checkAccount(existingAccount);
  if (existingRole) checkRole(existingRole);
  if (!before.etag || !Array.isArray(before.bindings)) fail('invalid_policy_read');
  const plan = { project, serviceAccount: email, role: roleName, permissions,
    createIdentity: !existingAccount, createRole: !existingRole, addBinding: !hasBinding(before), createKey: false,
    changesBillingPlan: false, sendsEmails: false };
  if (!apply) console.log(JSON.stringify({ mode: 'read-only', ...plan }, null, 2));
  else {
    const privateDirectory = path.resolve(directory, '../private');
    fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 }); fs.chmodSync(privateDirectory, 0o700);
    const backup = path.join(privateDirectory, `sandbox-iam-before-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { mode: 0o600, flag: 'wx' });
    if (!existingAccount) checkAccount(await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`, 'POST', {
      accountId, serviceAccount: { displayName: 'MinimalPairs sandbox billing backend', description: 'Isolated test identity for verified sandbox account reads and test subscription access projection. No key is created by this provisioning step.' },
    }));
    if (!existingRole) checkRole(await request(`https://iam.googleapis.com/v1/projects/${project}/roles`, 'POST', {
      roleId: 'minimalpairsBilling', role: { title: 'MinimalPairs billing access', description: 'Exact account lookup and Firestore document get/create/update; no user management, email sending, document listing or deletion.', stage: 'GA', includedPermissions: permissions },
    }));
    if (!hasBinding(before)) {
      const after = structuredClone(before);
      const binding = after.bindings.find(b => b.role === roleName && !b.condition);
      if (binding) binding.members = [...new Set([...(binding.members || []), member])];
      else after.bindings.push({ role: roleName, members: [member] });
      // Preserve all unrelated bindings, audit configuration, version and etag.
      // A concurrent policy edit must fail instead of being overwritten.
      await request(`${policyUrl}:setIamPolicy`, 'POST', { policy: after });
    }
    const [account, role, policy] = await Promise.all([request(accountUrl), request(roleUrl), request(`${policyUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } })]);
    checkAccount(account); checkRole(role); if (!hasBinding(policy)) fail('binding_readback_failed');
    const unexpected = policy.bindings.filter(binding => binding.role !== roleName && binding.members?.includes(member)).length;
    if (unexpected) fail('unexpected_project_role_requires_review');
    console.log(JSON.stringify({ mode: 'applied-and-read-back', ...plan, verified: true, unexpectedProjectRoles: unexpected, keyCreated: false }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ error: /^[a-zA-Z0-9_]+$/.test(error?.message || '') ? error.message : 'identity_provisioning_failed', note: 'No provider response, token or policy member list is included. Re-read state before retrying an uncertain write.' }));
  process.exitCode = 1;
}
