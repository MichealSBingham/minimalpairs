# Runtime Sandbox identity helper

`runtime-sandbox-identity.mjs` prepares one synthetic verified account and one temporary service-account key for the deployed billing integration test. It is an operator-only module. Importing it performs no I/O, and invoking it without an exact explicit mode prints help without using credentials or the network.

Its destinations are fixed:

- Firebase project `minimalpairs-billing-sandbox`, web app `1:350102033623:web:fa7a7f474fd7346218cc92`.
- Existing service account `minimalpairs-billing@minimalpairs-billing-sandbox.iam.gserviceaccount.com`.
- Existing general Stripe Sandbox `acct_1UKqIpJlJ2EM69u7`, using a test key read from ignored `rescue/billing/private/stripe-sandbox.json`.

The helper does not create or modify a Stripe object, contact Cloudflare, send an email, enable Google billing, change IAM, or read/write production customer data. The owner CLI OAuth token is used only by the local operator; it is never exported for deployment. The temporary service account has the restricted existing Sandbox role. Root owns all actual execution and deployment decisions.

## Exports

```js
import {
  prepareRuntimeSandboxIdentity,
  getFreshRuntimeSandboxIdentity,
  createRuntimeSandboxOperator,
} from './rescue/billing/operator/runtime-sandbox-identity.mjs';

// Mutates only the fixed Sandbox when needed; returns nonsecret status booleans.
const status = await prepareRuntimeSandboxIdentity();

// Returns secrets to this process only. Do not print, serialize to public reports,
// put in command-line arguments, or pass to the production Worker.
const identity = await getFreshRuntimeSandboxIdentity();
// identity.uid
// identity.idToken
// identity.serviceCredentials  (parsed service-account JSON object)
// identity.stripeSecretKey
// identity.projectId           ('minimalpairs-billing-sandbox')
// identity.stripeAccountId     ('acct_1UKqIpJlJ2EM69u7')
```

The ID token is freshly obtained through Google, then verified by the actual Sandbox Firebase adapter: signature, issuer/audience, verified email, current identity state and revocation checks. An owner account lookup also checks that the exact synthetic account still exists and is verified/enabled. Refresh checks the returned Google project number. Each export verifies the actual Stripe account behind the local test key; file metadata alone cannot authorize a replaced key. These checks are read-only except for storing the refreshed private token/checkpoint.

Preparation first verifies Google billing remains disabled, email/password authentication is available, the exact web app and service identity match, and the test key resolves to the exact Stripe account. A new key is allowed only when the service identity has zero user-managed keys. A UID of the form `runtime_<32 random hex digits>` uses the address `<uid>@example.invalid` and a random password. The account is marked verified through the administrative signup API; no verification or password-reset email method is called.

## Lifecycle and cleanup

```sh
node rescue/billing/operator/runtime-sandbox-identity.mjs --prepare
node rescue/billing/operator/runtime-sandbox-identity.mjs --status
node rescue/billing/operator/runtime-sandbox-identity.mjs --refresh

# Optional destructive identity-rejection checks for this exact synthetic UID.
node rescue/billing/operator/runtime-sandbox-identity.mjs --disable-user
node rescue/billing/operator/runtime-sandbox-identity.mjs --delete-user

# Only after disabling/stopping the test runtime and removing its secret bindings.
node rescue/billing/operator/runtime-sandbox-identity.mjs --cleanup --confirm-runtime-stopped
```

`--refresh` discards the returned credentials and prints only a success boolean. To use them in another operator routine, import `getFreshRuntimeSandboxIdentity()` instead. `createRuntimeSandboxOperator()` also exposes `prepare()`, `refresh()`, `status()`, `disableUser()`, `deleteUser()`, `cleanup({ runtimeStopped: true })`, and `adoptKeyForCleanup(keyId)`. Dependency overrides exist only for offline tests; the CLI exposes no project, URL or credential override.

Cleanup does **not** stop a deployed Worker or remove its secret bindings. `runtimeStopped: true` is the caller's explicit assertion that it has done so. Cleanup attempts each owned resource independently and retains incomplete state for another cleanup attempt:

1. The exact synthetic UID is looked up with its exact email before deletion and looked up afterward to confirm absence. A failed preflight that never attempted signup does not grant deletion authority over an existing identity.
2. Only that UID's `entitlements` document in the fixed Sandbox may be removed, and only if this run attempted signup. Its exact resource name and update timestamp are read first; a conditional delete refuses a concurrent document change. A final GET must report 404. No collection enumeration or broad delete occurs.
3. Only the checkpoint's exact user-managed service key may be removed. Both project and service-account identity are validated, and an exact GET must report 404 afterward.

Confirmed user deletion/disable removes stored password and refresh-token material. Confirmed key deletion removes stored private credentials. A completed checkpoint remains as a private tombstone: `prepare()` will not silently resurrect a disabled, deleted, or retired test identity. Starting a new lifecycle requires explicitly reviewing and archiving that completed private record, not removing an unfinished one.

## Interrupted execution

The private directory must be owner-only (0700); credentials, checkpoint and lock files must be owner-only (0600), regular files with one hard link. Symlinks, broad permissions and oversized private files are rejected. Atomic owned checkpoint updates retain the same `runId`. An exclusive lock blocks simultaneous invocations; no automatic stale-lock takeover occurs. If a process crashed, inspect its recorded PID and invocation and verify it is no longer running before manually removing only that abandoned lock. Retain the checkpoint.

Key and signup attempts are durably recorded **before** the external POST. A lost signup reply is recovered by the exact UID/email lookup, without another signup. A lost key reply never repeats key creation; absent credentials remain an explicit uncertainty. The helper cannot recover a lost private key, and an uncertain key is for cleanup only.

After separately inspecting the exact service account's key inventory and identifying the attempted resource, the operator may run:

```sh
node rescue/billing/operator/runtime-sandbox-identity.mjs --adopt-key-for-cleanup KEY_ID
node rescue/billing/operator/runtime-sandbox-identity.mjs --cleanup --confirm-runtime-stopped
```

Adoption requires a pending creation attempt, no saved key name/credentials, the fixed project/service account, a user-managed key, the exact supplied key ID, and a creation time within the recorded request window (one second clock tolerance before the attempt, at most 20 seconds after it). It immediately retires the lifecycle for cleanup. Time proximity alone is not proof of ownership: the operator must identify the resource first. An unidentifiable or out-of-window key remains unresolved for separate review; the helper does not guess or delete every key.

## Validation status

The helper has **20 passing offline tests** as of 30 September 2026. They exercise successful preparation/refresh, duplicate prevention, lost-response recovery, exact Sandbox/mode boundaries, disabled identities, independent cleanup/retry, conditional document deletion, failed preflight authority, lock/checkpoint replacement and file permissions. All HTTP responses, credentials and users in those fixtures are synthetic; the test code supplies both its own transport and verifier. No Google/Stripe/Cloudflare call or real credential read was performed for this implementation validation.

```sh
node --test rescue/billing/operator/runtime-sandbox-{identity,state}.test.mjs
```

The prior [standalone Google probe](sandbox.md) separately verified actual token signing, service permissions and temporary resource cleanup. These offline tests do not establish that this new helper has been run, that a deployed Worker has received credentials, or that end-to-end payment/access behavior has passed.
