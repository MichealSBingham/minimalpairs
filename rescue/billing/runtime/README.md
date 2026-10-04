# Worker and SQLite billing runtime

Status on 28 September 2026: deployed disabled on the verified Workers Free plan, after local validation. All deployed and checked-in service, checkout and communications flags remain false; the deployed Worker has zero secret bindings. This is infrastructure deployment, not an operational checkout. The current application does not import this package.

Wrangler deployment/version readback verified version `8072bc65-8eee-4ae7-a417-a024b88618c0` at 100% in deployment `b0775310-0e36-4de6-a9e1-4414012163ab`, created `2026-09-28T23:45:22.894878Z`. Readback confirms fetch/scheduled handlers, the `BillingLedger` namespace binding, SQLite migration `v1`, no preview and the three false switches. No provider credentials or customer ledger data were installed. Reported startup was 3 ms; actual request CPU, provider permissions and end-to-end billing remain unverified. External route-state verification is recorded separately by the deployment owner.

`worker.mjs` is the production entry point. Disabled requests stop at the edge without creating a Durable Object, requiring a credential, or constructing provider adapters. An enabled request goes to a named `BillingLedger` object. The object combines the core policy with the separate Firebase and Stripe providers. The production Firebase factory requires live Stripe mode, so a test-mode configuration cannot construct production ports. Updated local source selects a distinct fixed Sandbox factory for test mode; its project and actual Google probe are [documented separately](../operator/sandbox.md). This source is now included in the disabled deployment; no provider credentials or enablement were added. Firebase/Stripe secrets are server bindings only; this module creates none.

The dedicated Firebase identities and exact four-permission custom project roles have been [provisioned and read back](../operator/README.md), with zero retained keys and unrelated IAM policy fields preserved. The separate Sandbox identity passed actual Google permission checks from a local operator process; its temporary key and synthetic data were removed and verified absent. Protected runtime authentication, private deployment credentials, production identity permission checks and deployed provider validation remain outstanding. The deployed Worker remains disabled.

`ledger.mjs` uses real SQLite tables for unique UID/customer bindings, immutable customer-creation reservations, pending checkouts, event processing, and indexed periodic customer reconciliation. The ledger holds private verified email only inside the customer-creation reservation, preserving retry parameters. Event rows contain the minimal signed envelope, retry state and a sanitized error category, never raw payment/customer payloads. The core defines checkout, checkout-status, portal and webhook routes; the deployed service exposes no active public URL. Operational counts exist as a private object method, with no public administration endpoint.

## Durability and concurrency

- The SQL primary key preserves the first customer reservation for a UID. A unique reverse customer index prevents one Stripe customer being bound to two UIDs. Binding changes are rejected.
- Checkout and reconciliation run under the same Durable Object concurrency gate across external awaits. Each workflow has a shared 25-second deadline, below the gate's 30-second hard limit. Both real providers receive its AbortSignal and absolute deadline through `getOperationContext()`, cap their request/operation budgets, and abort fetch/body reads. The gate awaits actual settlement after abort; no timer race releases it while side effects continue. Normal provider exceptions are caught inside the gate and rethrown outside it, so they do not unnecessarily reset the object. A reset leaves already committed reservation/event state available for recovery.
- AsyncLocalStorage scopes the shared context to that workflow's async chain. Authentication before the gate keeps its provider's own bounded deadline, and contexts do not remain after gate exit. The production timeout has no environment override; only the separate synthetic test subclass shortens it. Providers must honor cancellation through settlement within the remaining five-second margin; a noncooperative future adapter is not made safe by the timer alone.
- Pending checkouts store the core's frozen parameters and operation key. Retiring a completed checkout compares the session ID in the SQL delete; an old completion cannot erase a newer reservation.
- Enqueue commits the event insert and alarm scheduling in one storage transaction before HTTP success. Duplicate IDs retain the original event and retry schedule; an altered identity under the same ID is rejected. A scheduling failure rolls back the insert and produces a retryable HTTP failure.
- Each durable customer binding atomically schedules an initial check after one minute. Subsequent successful checks schedule six hours later. Existing bindings are backfilled once when an upgraded object starts; restarts never reset an existing due date or retry state. Unbound creation reservations and metadata-only customers are not enrolled.
- Each periodic check re-reads the stored UID/customer map and calls `reconcileBoundCustomer`. It shares the webhook processor's canonical provider fetch, access rules, administrative-block-preserving writer, and exact completed-checkout retirement helper. It fabricates no event and never writes legacy grants. The existing production Firebase live-mode guard remains in force.
- The alarm processes at most five total due work items, alternating webhook events and customers using a persisted preference. Each queue orders by oldest due time, then stable ID. Both queues use indexed due queries; neither a webhook backlog nor a customer backlog monopolizes a batch. A later delivery cannot postpone an already-earlier alarm for overdue work.
- Before external work, a storage transaction persists the attempt, retry deadline and next alarm. Failures use exponential delay from one minute up to six hours, retaining sanitized error categories. A crash during or after projection therefore leaves durable retry state; the retry fetches fresh canonical state. Success resets the customer's consecutive attempt count and records its last successful check. Webhook success still marks only that event processed.
- Constructors re-arm the earliest pending event or customer check after eviction/restart. Disabled alarms preserve their rows and perform no provider work; re-enabling a new runtime resumes due records. SQLite cursors are consumed before external awaits.
- One hourly scheduled Worker invocation also calls the private `rearmFromDurableState()` method. It restores the earliest normal alarm from existing durable due state, preserving backoff and queue contents. It never creates an event or performs provider work directly. Disabled scheduled invocations return before config parsing or namespace/storage access, creating no Durable Object. The normal alarm remains the only background processor.

These choices follow Cloudflare's [SQLite storage/transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [concurrency gate semantics](https://developers.cloudflare.com/durable-objects/api/state/), [async context support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/), and [alarm retry semantics](https://developers.cloudflare.com/durable-objects/api/alarms/).

The initial object is deliberately small and serial: a slow checkout can delay another customer's billing operation. This is acceptable only after real latency/volume validation. Severe storage/quota failures can prevent writing a new alarm; Cloudflare's limited automatic retries are not an indefinite recovery guarantee. After storage recovers, the independent hourly trigger can restore a missing alarm without a user request. If both the scheduled trigger and alarm/storage infrastructure remain unavailable, trusted operator recovery is still required. This is a recovery path, not a guarantee of hourly execution through a platform outage. The periodic sweep covers only durably bound customers, including inactive ones; it cannot repair an ambiguous external customer creation that never acquired a binding. There is no public operational dashboard or pruning policy. An unrelated/unknown Stripe customer remains pending rather than being silently granted or discarded.

## Periodic recovery scope and private status

A healthy bound customer is checked approximately four times per day, in addition to webhook-driven work. The six-hour cadence is a low-volume cost/recovery tradeoff, not an immediate revocation promise: a missed refund or renewal may remain stale until its next successful check. Provider failures, a backlog, disabled service, quota exhaustion or lost alarm infrastructure can extend that interval. Existing grants still expire at their paid-period deadline independently of this scheduler. Provider call count per check varies with pagination and payment history; no production cost or latency claim follows from local tests.

The existing nonpublic `getOperationalSummary()` now includes a `reconciliation` aggregate: enrolled customer count, due count, failing count, unfinished attempts, never-successful count and earliest next due timestamp (epoch milliseconds). Event counts also distinguish `unfinished` attempts. `unfinished` means claimed but not durably completed, which can be current work or a reset awaiting retry; it is not counted as a confirmed provider failure. There are no customer identifiers, emails or raw errors in the aggregate and no new public route. A trusted operator integration is still needed to consume it. Success timestamps describe canonical checks, not successful customer payments.

## Configuration

`wrangler.jsonc` selects only the production entry point and SQLite class. `workers_dev`, preview URLs and observability are disabled, and the checked-in configuration declares no public route. One hourly Cron Trigger, at minute zero, was deployed with the disabled Worker. It schedules 24 wake times per day for the ledger, rather than one trigger per customer; retries can add invocations. All service flags remain false, so the scheduled handler returns before namespace or provider access. The implementation uses Cloudflare's [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) and [Cron Trigger configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/); tests dispatch real local [scheduled events](https://developers.cloudflare.com/workers/testing/miniflare/core/scheduled/).

| Binding | Purpose |
|---|---|
| `BILLING_SERVICE_ENABLED` | Exact string `true` is required for all processing; checked-in `false`. |
| `BILLING_CHECKOUT_ENABLED` | Separate new-sales switch; checked-in `false`. |
| `BILLING_COMMUNICATIONS_APPROVED` | Checkout/portal guard; checked-in `false`. Firebase-only email approval does not set this. |
| `BILLING_CONFIG_JSON` | App origin, expected Stripe mode, reviewed server prices and portal configuration. Embedded enable flags are ignored. |
| `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID` | Passed only to the real Stripe provider after service enablement. |
| `STRIPE_WEBHOOK_SECRETS_JSON` | One or two webhook secrets for exact-body verification/rotation. Never put actual values in source. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` | Passed only to the real Firebase provider after enablement. |

Stopping new sales should turn off checkout only, keeping existing customer cancellation/portal and entitlement reconciliation available. The broad service switch is an emergency disable, not a routine sales pause.

## Repeatable local validation

From `rescue/billing`:

```sh
npm ci --ignore-scripts
npm run test:runtime
npm run dev:local -- --port 8799 --inspector-port 9239
```

The last command is local-only and remains disabled. The manual smoke check returned HTTP 503 with `billing_not_enabled` at `/billing/checkout`, then the local server was stopped. No provider credential or cloud account was needed. Its reported request elapsed time is not a production CPU benchmark.

Pinned tools: Wrangler **4.143.0**, Miniflare **5.20260926.0-alpha** (the current Wrangler dependency), workerd **1.20260926.1** via the lockfile, esbuild **0.28.2**, and runtime JWT library jose **6.2.12**. Installation reported zero known npm audit vulnerabilities. Miniflare's version-4 option converter does not carry its old persistence option into version 5, so tests explicitly set the new resource persistence paths. They reopen the same temporary SQLite directory after disposing and recreating the entire local runtime. Test data is synthetic and removed afterward. Telemetry, external requests and development registration are disabled in the harness.

**33 tests passed** against the actual local workerd/SQLite engine:

1. Exact server switches and malformed configuration.
2. Disabled HTTP and background queue writes.
3. Concurrent first reservation and unique reverse customer binding.
4. Sixteen concurrent checkout requests produce one simulated customer/checkout.
5. Post-provider/pre-ledger failure recovers with the same key after runtime restart.
6. Actual Durable Object eviction retains reservations/bindings.
7. Concurrent event dedup, identity-conflict rejection and restart persistence.
8. Real SQL transaction rollback when alarm scheduling is deliberately failed.
9. Actual alarm retries a failed projection with sanitized error state.
10. Attempts/errors/backoff survive restart without premature retry.
11. Post-projection failure re-fetches and completes after restart.
12. Customer metadata alone cannot bypass the durable reverse binding.
13. Compare-and-retire preserves newer checkout state.
14. Disabled restart preserves work; re-enable resumes it.
15. Signed HTTP webhook is present in SQLite after restart.
16. Production bundle excludes fixture routes and stays inert without credentials or object initialization.
17. Slow checkout cancellation keeps the gate through asynchronous provider cleanup; a concurrent retry succeeds and no late synthetic side effect occurs.
18. Async context stays scoped across awaits, is absent outside that scope, and is cleared after gate exit.
19. A real alarm persists shared-deadline failure/backoff through restart, then successfully retries after the provider recovers.
20. Binding and its initial due/alarm commit atomically; scheduling failure rolls back both, and unbound reservations stay excluded.
21. Actual alarms recover a missed renewal and then a full refund with no webhook rows, scheduling the next successful check six hours later.
22. Periodic failure/backoff survive full runtime restart, grow from one to two minutes, and reset after success.
23. A post-projection scheduling failure retries fresh state after restart rather than preserving a subsequently refunded grant.
24. Periodic canonical reads receive the same shared cancellation deadline and retain retry state after cancellation/restart.
25. Disabled deployments leave periodic work paused; enabling resumes it.
26. Existing customer bindings are backfilled on upgrade and retain that schedule on later restarts.
27. Five-item batches alternate both queues and preserve fairness preference across runtime restart.
28. A new webhook delivery cannot move an existing earlier alarm later while customer work is already overdue.
29. A real scheduled event restores a lost alarm after runtime restart, leaves due/attempt state unchanged, and makes no provider call until the ordinary alarm runs.
30. Scheduled recovery preserves future backoff and creates no empty-queue alarm.
31. Disabled scheduled events create no object and do not modify previously paused work; the production bundle's disabled scheduled handler is also exercised.

32. Concurrent explicit checks retire only an exact provider-confirmed expired checkout, create no new checkout or grant, and retain the result across restart.
33. An external creation with an uncertain local outcome remains pending after an explicit status check and restart.

`fixture-worker.mjs` supplies synthetic provider responses and controlled failure points. It is never imported by the production entry point; the smoke test checks that its routes/tables are absent from the production bundle. Authentication decisions, Stripe behavior and Firestore projection responses in these runtime tests are simulated. SQLite, transactions, concurrent requests, gates, alarms, object eviction and runtime restarts are real local operations. Graceful whole-runtime restart and object eviction are tested; a physical power loss or a deployed Cloudflare failure is not. Provider contract tests are separate in `providers/`.

This is stronger evidence than in-memory ledger mocks. The separate disabled deployment and binding/version readback establish the deployed artifact's configuration, but neither establishes live provider permissions, Stripe messaging behavior, a working checkout, distributed infrastructure availability or free-tier production capacity. Those launch dependencies remain in the parent billing README.
