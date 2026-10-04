# Stripe HTTP adapter — 28 September 2026

**Included in the deployed disabled Worker; not connected to a Stripe account.** `stripe.mjs` constructs real Stripe HTTP requests and normalizes their responses. Its tests replace only the HTTP transport with synthetic fixtures. The [deployment readback](../runtime/README.md) confirms zero secret bindings and all three enable flags false; it is not an operational checkout. No live API request, credential, customer data, price creation, payment, refund, portal session or communication was used to develop or test this adapter. All service/checkout/communication flags remain false until the separate launch requirements are satisfied.

## Version and source boundary

Every request explicitly sets `Stripe-Version: 2026-08-26.dahlia`, the version identified by the official versioning page at review time. Fields were checked against Stripe's exact GA OpenAPI snapshot at commit `30d3391cc09a0f67ad29bee002f570811b19e1da`, whose `info.version` is the same. Moving OpenAPI master already describes a later release; it was not used as the schema contract. Future upgrades require fixtures and policy review. The webhook endpoint should use the same version, although the core queues only minimal identifiers and this adapter retrieves current objects independently. [Versioning](https://docs.stripe.com/api/versioning), [pinned official schema](https://github.com/stripe/openapi/blob/30d3391cc09a0f67ad29bee002f570811b19e1da/openapi/spec3.json).

## Interface

```js
import { createStripeAdapter, STRIPE_API_VERSION } from './providers/stripe.mjs';

const stripe = createStripeAdapter({
  secretKey: env.STRIPE_SECRET_KEY,
  expectedAccountId: config.stripeAccountId,
  expectedLivemode: config.expectedLivemode,
  prices: config.prices,
  // Optional: fetchImpl, timeoutMs, operationTimeoutMs, maxPages,
  // maxRequests, maxResponseBytes, now (milliseconds; fixture clock),
  // getOperationContext: () => ({ signal, deadline }) or null.
});
```

Factory construction is inert. The first actual operation retrieves `/v1/account` and requires the configured account ID. The key prefix must match test/live mode; every applicable retrieved object is separately checked for mode. Requests use only `https://api.stripe.com`, never a supplied host, and never set a Connect account header or follow redirects. No raw Stripe error message/body is surfaced. [Account retrieval](https://docs.stripe.com/api/accounts/retrieve).

| Method | Adapter result and boundary |
|---|---|
| `createCustomer(params, idempotencyKey)` | Form-encoded customer POST; returns only ID, mode and binding metadata. The core supplies approved email/UID/schema and the durable creation key. |
| `retrieveCustomer(customerId)` | Fresh customer GET; deleted/mismatched objects fail. Does not expose billing addresses or email. |
| `createCheckoutSession(params, idempotencyKey)` | Validates the configured price's actual current type, currency, interval and fixed amount before the POST. Requires one recurring item, one unit and card payment. Returns normalized session identifiers/URL/state. |
| `retrieveCheckoutSession(sessionId)` | Fresh GET; expanded or string subscription reference becomes a subscription ID or explicit `null`. |
| `createPortalSession(params)` | Retrieves the named configuration before POST. Requires payment-method updates and cancellation at period end, with no cancellation proration and subscription updates disabled. Does not create/change a portal configuration. |
| `listAllSubscriptions(customerId)` | Fully paginates `status=all` for that customer; returns minimal identifiers/status/mode/creation fields. Any incomplete page or wrong customer/mode throws. |
| `resolveEventCustomer(event)` | Retrieves the current Checkout/subscription/invoice/charge/refund/dispute object by queued type and ID, follows refund/dispute → charge when needed, then fetches the customer. Returns `{customerId, customer, subscriptionId}`. |
| `currentSubscriptionSnapshot(binding)` | Retrieves canonical current customer state and returns the core's normalized subscription/paid-period shape only after all required evidence succeeds. |

**The durable ledger owns identity binding.** It must reverse-map `customerId` to a stored UID and compare fresh `customer.metadata.firebaseUid`. Customer metadata alone is not permission to create a ledger binding. The snapshot additionally requires schema `1` on the customer and selected subscription. Unknown customer, unsupported object relationship or lookup failure is never classified as an unrelated event. Historical one-off events may therefore need operator reconciliation; no unknown-customer ignore shortcut exists.

## Implemented staged policy

Selection retrieves all subscription statuses. More than one nonterminal subscription blocks reconciliation. One nonterminal subscription wins over old canceled subscriptions. Otherwise the most recently created terminal subscription is selected; tied creation times require review. An actually empty, fully retrieved list yields an explicit inactive snapshot. A canceled selected subscription remains identified so the core can safely retire its matching completed Checkout reservation.

The supported subscription has one item/quantity, an approved fixed USD monthly or annual licensed price, automatic collection, no trial, tax, discount, usage threshold, scheduled alteration, pending update or collection pause. Both classic and flexible billing modes can be accepted only within that constrained shape. Actual provider price facts must match the server configuration; optional `prices[plan].unitAmount` pins the intended cents amount as well. Before enabling sales, supply reviewed immutable price IDs and pin the approved amounts. Archiving a price does not revoke existing paid coverage, but it blocks a new sale.

Coverage uses each **invoice line's service period**, not invoice-level `period_start`/`period_end`. Current positive paid coverage requires a single unprorated recurring line with the selected subscription/item/price, matching invoice/line/price amounts, zero customer balance offsets and no credit notes, shipping, revisions, taxes or discounts. Old/future service periods are not used to grant current access; an old refund cannot remove a separately paid current period. [Invoice line periods](https://docs.stripe.com/api/invoice-line-item/object), [invoice fields](https://docs.stripe.com/api/invoices/object).

For every relevant invoice the adapter retrieves all invoice payments, accepts one default paid PaymentIntent allocation, and reverse-lists allocations for that PaymentIntent to reject shared payments. It then retrieves the PaymentIntent and all associated charges, requiring one successful fully captured card charge for the exact customer, currency and amount. Failed earlier charge attempts may coexist. Manual/off-Stripe payments, legacy direct-charge invoice payments, multiple successful payments, shared allocation, alternative payment methods and manual capture remain unsupported. [Invoice payments](https://docs.stripe.com/api/invoice-payment/object), [paginated payment listing](https://docs.stripe.com/api/invoice-payment/list), [charges](https://docs.stripe.com/api/charges/list).

All refunds for the charge are paginated; only `succeeded` amounts count. Their total must agree with the charge aggregate before a new projection is allowed. A mismatch throws for reconciliation instead of pretending the missing evidence is zero. Refunds have no `livemode` field in the pinned schema, so charge/customer/payment relationships establish their scope. All disputes are also paginated and relationship/mode checked. Full successful refunds and non-won dispute states exclude coverage through the core. Partial refunds retain coverage; exclusively won disputes can restore it. Warning/`prevented` dispute states are conservatively blocked pending a broader policy, even though they are not synonymous with a lost chargeback. [Refund object](https://docs.stripe.com/api/refunds/object), [dispute listing](https://docs.stripe.com/api/disputes/list).

Embedded item/line lists are used only when explicitly complete; otherwise their full endpoint is paginated. Pagination checks `has_more`, unique IDs and a progressing cursor, and retains customer/subscription/payment filters on every page. Limits throw rather than return truncated arrays. Relevant refunds, disputes, invoice payments and charges are always read through their complete list endpoints. An unknown shape or network failure does not produce a new grant or an empty successful result.

## Runtime, retries and remaining obligations

- Defaults: 5 seconds per HTTP request, 20 seconds per adapter operation, 20 pages per list, 100 requests per operation and 2 MiB per response. Responses are streamed with a byte limit; requests are aborted on timeout. These bounds are safeguards, not measured Worker performance or cost estimates.
- The runtime must pass `getOperationContext: () => ({signal, deadline})`, where `deadline` is epoch milliseconds for the entire serialized workflow and `signal` is its cancellation signal. Null is permitted outside a shared workflow. Each adapter operation re-reads that callback, caps its local deadline, rejects an already expired/aborted context before any request, and propagates abort through fetching **and response-body reading**. The ledger must retain its lock until all awaited work settles after cancellation; a bare race that releases the lock while provider writes continue is unsafe. This prevents successive individually bounded methods from silently exceeding the Durable Object's overall concurrency-gate budget.
- `StripeAdapterError` exposes only `code`, HTTP `status`, `retryable`, and bounded `retryAfterSeconds`. HTTP 429/5xx, transport failure and timeouts are retryable. There is no inline automatic financial POST retry. The durable coordinator must schedule retries with backoff and retain the original creation operation/key; a new key must never be invented for an ambiguous outcome. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).
- The adapter performs a sequence of fresh reads, not an atomic Stripe transaction. Concurrent provider changes can make the graph inconsistent; the coordinator must retry and periodically reconcile. An adapter exception leaves the previous projection untouched; an already-issued grant is still bounded by its stored expiration. Missing or permanently unsupported evidence needs visible operator review, not endless silent retries.
- Core and runtime must enforce `serviceEnabled`, `checkoutEnabled`, communication approval, authenticated UID ownership, lifetime protection, durable serialization, durable enqueue, atomic matching-reservation retirement and Firestore write preconditions. This provider does not replace those controls.
- Use a private restricted key with the exact read/write capabilities needed by these endpoints, including account and portal-configuration reads. Verify those capabilities in an authorized Stripe Sandbox; no permissions have been tested here. Do not use owner CLI credentials or expose secrets in logs/browser bundles.
- Portal feature checks cannot inspect or suppress all Stripe account-level receipts, renewal notices, recovery messages or receipt-link emails. Owner-approved concrete communication settings and templates remain a prerequisite for any live or Sandbox flow that might contact a person.
- No cancellation, subscription update, invoice send, refund creation, price creation, dispute action or email-send method is implemented. Existing static exercises remain public; paid-feature enforcement is a separate application boundary.

## Local validation

```sh
node --test rescue/billing/providers/stripe.test.mjs
```

The suite uses actual `Request` options, form encoding, headers, `Response` parsing, streaming limits and abort behavior against a mocked `fetch` transport. Synthetic fixtures exercise the full normalization path and the real core entitlement policy. Coverage includes account/mode/UID mismatches, pagination beyond first pages, incomplete/duplicate lists, stale event payloads, canceled versus current subscriptions, multiple memberships, incomplete payment graphs, price/portal checks, refunds, disputes, limits and safe errors.

Shared-budget regressions cover zero requests after prior cancellation/expiry, aborting an in-flight fetch and a stalled body stream, preventing subsequent payment-graph requests, capping the local timeout, and reusing a cached factory across different workflow contexts.

These tests do **not** validate Stripe credentials/permissions, actual account settings, real Checkout/Portal behavior, receipt delivery, distributed races, provider consistency timing, Worker CPU, deployed cost or a real payment. No live billing readiness claim follows from a passing fixture suite.

## Actual Sandbox follow-up

The [28 September hosted Sandbox probe](../operator/stripe-sandbox.md) now validates actual monthly Checkout, portal cancellation, full test refund and canonical access projection using this adapter. This is separate from the fixtures and does not establish a deployed Worker/Firebase purchase flow or production readiness. The adapter now accepts an optional idempotency key for portal creation; the 42-check provider suite includes a stable-key uncertain-retry regression. Restricted-key permissions remain untested; the isolated operator used its private test key.
