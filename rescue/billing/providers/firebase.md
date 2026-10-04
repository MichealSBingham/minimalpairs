# Firebase billing adapter — 28 September 2026

Included in the [deployed disabled Worker](../runtime/README.md); no production service-account credential has been installed or tested. The dedicated identity and exact four-permission IAM role have been [provisioned and read back](../operator/README.md), with zero keys. This adapter is separate from the browser sign-in SDK. It verifies identities and projects subscription access only after the still-outstanding credential/configuration steps and service enablement. It has no email-send, account-create, provider-link, user-delete or legacy-migration method. Deployment is not evidence of an operational checkout or live Firebase reconciliation.

## Production boundary

`createFirebaseAdapter(env, options)` requires `options.expectedLivemode === true`, project `minimalpairs`, and a service-account JSON credential whose project and email match that project. Missing or Sandbox mode rejects before any provider call. `createSandboxFirebaseAdapter` independently requires exact `false` and the fixed project `minimalpairs-billing-sandbox`. Both factories reject the other environment's credentials and ID tokens. The runtime selects a factory from its validated billing mode. The isolated Sandbox is now provisioned and its actual Google provider probe passed; [scope and cleanup evidence](../operator/sandbox.md). The updated factory selection remains local source, not a new deployed Worker version.

Google certificate, OAuth, identity and Firestore endpoints are fixed. Production supplies neither a custom endpoint nor a custom transport. `fetchImpl` and `now` are injected only by local tests. No credentials, tokens, account email, raw provider error response or document body should be logged. The reviewed `firebaseauth.users.get` and Firestore document get/create/update permissions are now provisioned in both projects and were exercised successfully only in the isolated Sandbox. The temporary test key was removed and read back absent. The current factory requires a private-key service-account JSON credential; a zero-key identity alone cannot initialize it, and a keyless authentication path is not implemented.

## Identity and existing customers

ID tokens require a genuine RS256 signature using Google's published certificate, exact issuer and audience, valid timestamps, a bounded UID, a verified email and no tenant. Certificate caching follows the provider's max-age and Age headers. Unknown key IDs cannot force repeated fetches during that cache lifetime. Token verification follows the [Firebase verification contract](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

Signature verification alone does not establish current account eligibility. Every verification separately looks up the exact UID using [Identity Platform accounts.lookup](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup). The account must still exist, be enabled and verified, retain the same normalized email, and have no token revocation newer than the token's authentication time. Current identity is not cached. The relevant provider fields are documented in [UserInfo](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/UserInfo).

Legacy grants are read only at `legacyEntitlements/{normalizedEmail}`. Normalization trims and lowercases; plus aliases and dots are not collapsed. The adapter has no method that overwrites, removes or creates a lifetime grant.

## Subscription projection

Only `entitlements/{uid}` is writable. The writer validates a small field allowlist and never accepts a lifetime subscription plan. An active projection needs a known monthly/annual plan, customer and subscription identifiers, a future paid-period end and the canonical paid-period reason.

Each write first reads the exact document and then uses [Firestore commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit) with a field mask and either the exact prior `updateTime` or an absence precondition. A concurrent change triggers a fresh read with at most three attempts. Unrelated fields survive. An administrator's block always wins; newer projections, malformed block fields and lifetime-shaped UID grants are not overwritten. [Write preconditions and masks](https://firebase.google.com/docs/firestore/reference/rest/v1/Write).

The adapter does not independently prove that a Stripe payment occurred. That evidence belongs to the Stripe adapter and core policy. A successful return requires the database's write confirmation; an interrupted write is an uncertain outcome, resolved by durable reconciliation rather than by assuming success.

## Time and response limits

Default HTTP timeout is five seconds, with a 256 KiB response limit and a 20-second operation budget. The factory accepts `getOperationContext: () => ({signal, deadline}) | null`, where the deadline is epoch milliseconds. Each public operation captures that shared context, caps its local budget, rejects expired/cancelled work before making a request, and propagates cancellation to both fetch and body reading. OAuth, identity checks, document reads and commit retries consume the same budget. The runtime retains its concurrency gate until cancellation has settled. No background write is launched after returning an error.

Service-account OAuth uses the fixed Google token destination, a signed short-lived assertion, and datastore/identitytoolkit scopes. Access-token caching is bounded. Only completed tokens/certificate responses are shared: simultaneous cache misses retain independent requests and cancellation contexts. Missing-document responses explicitly abandon their body and abort that transport. See [Google's service-account OAuth flow](https://developers.google.com/identity/protocols/oauth2/service-account).

## Verification and remaining work

`firebase.test.mjs` uses real ephemeral RSA signatures and X.509 certificate parsing, with synthetic Google HTTP responses. It covers identity changes/revocation, exact project/UID/email binding, legacy read-only behavior, optimistic write races, admin blocks, field preservation, production-mode gating and cancellation. These fixtures establish adapter behavior, not real Google credentials or deployed permissions.

`firebase.emulator.test.mjs` additionally exercises the actual local Firestore REST implementation and persistence. Its transport permits only the local demo project on port 8089, substitutes a synthetic OAuth response and translates the fixed project path inside that test. It injects an administrator block between read and commit and verifies the retry preserves the block and unrelated note. The production adapter has no emulator routing option. The integration check exposed a query-parameter precondition problem during development; the final implementation uses the commit request's structured precondition and passed the real emulator check.

IAM provisioning and disabled Worker deployment have been read back. The separate Sandbox destination and its actual service-account token/account/read/write/isolation checks are verified locally. Production runtime credentials, Stripe-to-Firestore reconciliation, deployed request CPU/limits and a full purchase remain unverified. An enabled browser authentication provider is not evidence that this backend adapter is production-ready.
