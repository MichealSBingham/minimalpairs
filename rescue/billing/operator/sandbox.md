# Isolated payment test project — 28 September 2026

The free Firebase project `minimalpairs-billing-sandbox` (number `350102033623`) is provisioned separately from the customer project `minimalpairs` and audio project `minimalpairs-audio-20260928`. It has a standard `(default)` Firestore database in `nam5`, with deletion protection enabled, and web app `1:350102033623:web:fa7a7f474fd7346218cc92`. No customer data was copied. Google billing was read back as disabled. The production project also remains billing-disabled. A fresh [setup readback](../../qa/billing-sandbox-setup-2026-09-28.json) records the exact database, authentication, rules-release and zero-key state without credentials or authentication hashing material.

The Firebase CLI successfully deployed email/password authentication and the same client Firestore rules as the app, using `rescue/firebase.billing-sandbox.json`. Its provisioning API initialized the authentication subtype as `IDENTITY_PLATFORM`; this did **not** link a billing account or upgrade to Blaze. Identity Platform on Spark has a 3,000 daily active user limit. No SMS or email-link provider, Google sign-in, email template change, or email send was requested. [Firebase CLI configuration](https://firebase.google.com/docs/auth/configure-providers-cli), [Spark authentication limits](https://firebase.google.com/docs/auth/limits).

`provision-sandbox-identity.mjs` pins this project and created the dedicated `minimalpairs-billing` service account and `minimalpairsBilling` project role, with exactly `datastore.entities.create`, `datastore.entities.get`, `datastore.entities.update`, and `firebaseauth.users.get`. No additional project-role binding was found. The production identity remains separate and has no private key.

`createSandboxFirebaseAdapter` accepts only exact test mode and this exact project's credentials, issuer, audience and endpoints. `createFirebaseAdapter` still requires exact live mode and `minimalpairs`. The Worker selects between these two fixed factories, not an arbitrary project supplied by a caller. The fixed-factory source is included in the existing disabled Worker update recorded in the runtime deployment receipt. `wrangler.sandbox.jsonc` prepares a separately named Worker/ledger with all switches false, no routes and no secrets; that Sandbox Worker is not yet deployed. That update enabled no service, provider access or communications.

## Actual Google probe

`verify-sandbox.mjs --execute` performed a bounded local operator probe with a freshly generated `.invalid` account, random password and temporary key for the Sandbox service account. Passwords, private keys and tokens remained in process memory. No Stripe API was called; no email method was called. The script cannot select another project. Its private checkpoint records only the generated cleanup identifiers and prevents rerunning an unfinished probe.

[Sanitized results](../../qa/billing-sandbox-live-probe-2026-09-28.json) verify:

- A genuine Google-signed ID token and a current-account lookup through the actual restricted service identity.
- A missing legacy grant, an actual conditional Firestore create, and an update preserving an administrator block and unrelated field.
- Rejection of Sandbox credentials by the production factory.
- HTTP 403 `PERMISSION_DENIED` when the Sandbox identity tried to GET its synthetic document path in production. No production document was created or customer identifier used.
- Rejection of the previously valid token after the synthetic account was disabled.
- Cleanup readback: zero matching identities, exact test document 404, exact temporary key 404, zero user-managed service keys. The initial key-list endpoint briefly retained the deleted entry; the subsequent exact-key and list checks confirmed removal.

These checks validate real Google identity/signing/IAM/Firestore behavior from the local process. They do not validate Stripe, a paid purchase, a deployed Worker request, production runtime credentials, actual request CPU, or production throughput. A synthetic paid-period projection is test data, not payment evidence.

The Firebase fixtures pass 25 checks. The real local Firestore emulator passes both production and Sandbox cases (27 combined checks). After the live probe, independent review identified two operator cleanup risks: concurrent checkpoint replacement and trusting a returned key name before validating cleanup scope. Both were corrected with an atomic owned checkpoint, atomic journal updates, persistent uncertainty state, and an exact project/service-account key validator. Three offline tests cover competing starts, changed ownership and foreign cleanup targets. The final full billing suite including these tests passed **143 checks, with two expected emulator skips**; those two integrations were separately run successfully. The disabled Sandbox bundle also passed Wrangler's local dry run. The hardened operator was not re-run against Google because the live probe had already passed and cleanup was verified.

## Remaining integration

The separate [Stripe general Sandbox](stripe-sandbox.md) now has inspected communications, test prices and portal configuration. An actual hosted monthly checkout, portal cancellation, full test refund and local access projection passed using a synthetic identity. Configure the webhook and protected test credentials in the separate Worker, then measure the combined deployed end-to-end behavior and Free-plan request limits. No service identity key is currently retained, so an operational deployment still needs protected runtime authentication. Keep production and Sandbox credentials, customer maps, grants and ledgers separate. The disabled consumer billing UI does not by itself establish a paid feature boundary.
