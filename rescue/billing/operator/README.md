# Local billing identity provisioning

On 28 September 2026, the dedicated service identity `minimalpairs-billing@minimalpairs.iam.gserviceaccount.com` and custom project role `projects/minimalpairs/roles/minimalpairsBilling` were created and read back successfully. Its sole project-role binding contains exactly:

- `firebaseauth.users.get`
- `datastore.entities.get`
- `datastore.entities.create`
- `datastore.entities.update`

No private key was created. No deployed billing credential or real provider permission test is implied. The [billing Worker was separately deployed disabled](../runtime/README.md), with all three enable flags false and zero secret bindings; it is not an operational checkout. Google Cloud billing on the existing project was independently read as disabled; provisioning did not enable it or change the Firebase plan. No account email or customer entitlement was written.

These permissions cover the adapter's current account lookup and Firestore get/conditional commit methods. They omit document enumeration/deletion, user management, email sending, IAM modification and billing administration. This is a **project-scoped IAM role**, not collection-level isolation. The writer's fixed paths and field allowlist still matter; server IAM calls do not rely on client Firestore rules. [Firestore method permissions](https://docs.cloud.google.com/firestore/docs/security/iam), [account lookup permission](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup).

The local operator script uses the existing Firebase CLI sign-in only to provision cloud resources. It is not imported by the Worker and must never be deployed as a runtime credential mechanism.

```sh
# Inspect the fixed project, role and binding without changing them.
node rescue/billing/operator/provision-identity.mjs

# Apply only missing identity/role/binding steps, then read back.
node rescue/billing/operator/provision-identity.mjs --apply
```

The script refuses a pre-existing role with different permissions, a disabled/mismatched account, or malformed policy data. It preserves unrelated bindings and audit settings, keeps the policy etag to reject a concurrent change, and stores the prior IAM policy only in the ignored `billing/private/` directory with restrictive permissions. It never creates a key or prints credentials or policy-member lists. After an uncertain write, run the read-only command before deciding whether to retry. [Custom role creation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.roles/create), [service-account creation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create), [policy updates](https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/setIamPolicy).

The [isolated Sandbox project and actual Google probe](sandbox.md) are now complete. Its own four-permission identity successfully verified a real test token and wrote a synthetic subscription projection; the temporary key and test data were removed and read back absent. This does not test the production identity or a deployed Worker request. The separate [Stripe Sandbox probe](stripe-sandbox.md) now verifies its actual test credentials, proposed-price fixtures and hosted payment lifecycle. Still required: protected runtime authentication, combined deployed integration and production Stripe configuration. The current Firebase adapter specifically requires a private-key service-account JSON credential; identity creation alone does not satisfy it. The production factory's live-mode guard remains intact; the Sandbox factory is pinned to a different project.
