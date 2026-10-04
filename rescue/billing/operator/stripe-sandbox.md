# Actual Stripe Sandbox probe — 28 September 2026

Stripe access was restored through the owner's existing Google sign-in. The live business is `acct_1PFMIDJ2FK64SYOd`. No live settings or customer records were changed. A new **general Sandbox**, MinimalPairs Rescue QA (`acct_1UKqIpJlJ2EM69u7`), was created with **Copy live account to sandbox off**, no invitations and no customer-data copy. Unlike the original test-mode environment, a general Sandbox isolates settings and data. [Stripe testing environments](https://docs.stripe.com/testing-use-cases).

The owner-authorized free test work uses the exact Sandbox account and a test-only key kept in an ignored mode-600 file in a mode-700 private directory. The key was not printed or deployed. The operator checks the actual account before any mutation; the production and Sandbox Workers retain all three false flags, no routes and no runtime credentials.

## Communications boundary

The Sandbox dashboard was inspected before the test. Successful payment/refund emails, trial/renewal/card-expiry/payment-failure emails, confirmation links and invoice reminders were off. **Send finalized invoices and credit notes** was turned off and saved in this isolated Sandbox. Checkout promotional-email terms were not accepted. No live-account email setting changed.

These settings are dashboard observations, not fields validated through the probe API. Stripe also documents that receipts/invoices are not emailed by default in Sandboxes. The probe uses a randomly generated `@example.invalid` customer, no `receipt_email` override, no email-send endpoint, no manually sent receipt/invoice and no person as recipient. It selected a card and unchecked Link enrollment. Although Checkout requested only `card`, Stripe displayed Link and a bank option; neither was used. This is evidence of the card path, not proof that the hosted UI excludes every other method. Mandatory bank-debit email settings were left alone because those methods were not tested. [Stripe Sandbox email behavior](https://docs.stripe.com/testing-use-cases#test-email).

The local probe's `communicationsApproved: true` is scoped to this nonsending synthetic operation; it does not authorize production billing email. The user's verification/password-reset approval remains separate.

## Verified provider behavior

See the [sanitized machine report](../../qa/stripe-sandbox-provider-probe-2026-09-28.json). Its UTC timestamps fall on 29 September; local date was still 28 September.

- Created a test product, $9 monthly and $79 annual recurring test prices, and a portal configuration allowing payment-method updates and cancellation at period end, with subscription changes disabled. These are proposed-price fixtures, not sales or validated willingness to pay.
- The actual application adapter created the synthetic customer, hosted subscription Checkout and portal session using API `2026-08-26.dahlia`.
- Completed the hosted **$9 monthly** checkout in the browser with Stripe's documented `4242` test card. The live provider graph contained a completed Checkout, active subscription, paid invoice, invoice-payment allocation, successful card PaymentIntent and charge. The core access projection was active. The annual purchase path was not tested.
- Canceled in the **hosted customer portal**. Stripe returned `cancel_at` equal to the current period end, with `cancel_at_period_end: false`; the provider and core already handled this shape. The read-only cancellation check preserved paid access through that end date.
- Issued a full **test** refund. The real charge/refund graph showed 900 cents paid and 900 refunded; the core projection became inactive with `no_current_paid_coverage`.
- Canceled the test subscription immediately after the checks; readback was `canceled` and inactive, with no future renewal. The isolated product, prices, synthetic customer, portal configuration and historical test payment remain as fixtures. `--cleanup` means subscription cancellation, not erasure of all fixtures or cleanup of a partially prepared run.

No real funds moved. No actual customer was contacted. There is no new recurring revenue. [Stripe test payments](https://docs.stripe.com/testing-use-cases).

## Operator review and limits

`verify-stripe-sandbox.mjs` is not imported by the application or Worker. An exclusive lock serializes operator runs. A private checkpoint retains stable mutation keys, refuses uncertain replay after 23 hours, and keeps session URLs private. Before refund or cancellation it checks fresh customer UID/schema, Checkout ownership/UID/mode/subscription and the full canonical provider graph. Failures expose only fixed error categories. Independent review caught the missing pre-mutation binding check and a portal-session retry key gap; both were corrected. The adapter now accepts an optional portal idempotency key; the regression test preserves that key and body after a simulated uncertain failure. The initial successful hosted portal creation preceded this optional-key patch; no actual uncertain replay was needed.

The final billing suite passed **152 checks with two expected emulator skips**, including the 42 Stripe adapter checks and the real local Worker/SQLite tests. Those tests are separate from the actual hosted Stripe probe.

The probe validates actual Stripe behavior and the local core projection. It does **not** validate a deployed Worker, signed webhook delivery/replay, combined Firebase/Stripe entitlement writes, actual runtime CPU, renewal failure, disputes, annual checkout, or the final paid product. Those remain required before enabling sales. The Sandbox redirect destination is not yet a deployed membership app; its absence did not change the verified provider completion, but the entire customer return flow is still untested.

The next integration step is the isolated deployed runtime and actual entitlement round trip. Product work must also supply a worthwhile paid program; see the [paid program decision](../../../research/paid-program-implementation-decision-2026-09-28.md). Production checkout stays disabled.
