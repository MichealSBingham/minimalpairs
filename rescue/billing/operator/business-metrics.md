# Owner business metrics

Run from the repository root:

```sh
node rescue/billing/operator/business-metrics.mjs --days=30
```

The report performs only Stripe GET requests using the existing private restricted production credential. It verifies the account, rejects redirects, caps pagination at 2,000 records per resource, fails instead of returning truncated totals, and prints aggregate data without customer identifiers. No database writes, emails, purchases, refunds or subscription changes occur. Use 1–366 days; default 30. Network access is required.

Two separate scopes are intentional:

- **Current app offer:** completed paid checkout counts by monthly / annual / lifetime, checkout gross, current subscription states, active recurring list-price monthly value, and scheduled/finished cancellations. Includes live objects with this app's billing schema and Firebase binding metadata. Lifetime is a one-time purchase, never recurring revenue.
- **Entire Stripe account cash:** captured charges and successful refunds in the selected creation-time window. This includes legacy/unclassified sales and any other products in the account. Currencies remain separate. These are gross amounts before fees, disputes and payouts, not profit.

Amounts use minor units (USD 2900 = $29). Recurring value is explicitly **list price before discounts**, not net MRR. Checkout purchase dates use session creation, not payment settlement. The report does not invent customer attribution, visitor-to-purchase conversion, retention, trial conversion, or historical churn rates. A paid checkout can subsequently be refunded; refund counts are separately reported. It does not equate paid checkouts to active access or unique people.

For acquisition decisions, compare with the separate privacy-consented website funnel and Search Console. Do not add browser `checkout_started` events to revenue; Stripe is the payment source of truth. Old sales lacking metadata require explicit product reconciliation before assigning them to the current offer.

Validation: `node --test rescue/billing/operator/business-metrics.test.mjs` covers plan separation, lifetime exclusion from recurring value, annual normalization, cancellation exposure, refund status and complete pagination.

Optional `--owner-check` adds a separate classification of current-offer paid checkouts: owner email match, other email, and unknown email, with checkout dates and payment mode. Set `MINIMALPAIRS_OWNER_EMAIL` in your local environment, or put `{ "email": "your address" }` in the ignored, owner-readable-only file `rescue/billing/private/business-metrics-owner.json` (mode 0600). The report never prints those addresses. Only trim/lowercase normalization is used; aliases are not merged. This does not globally exclude purchases or cash because an alternate email and legacy customer associations cannot establish ownership reliably.

`currentOffer.paidCheckoutBySource` separates purchases and gross amounts using the optional consented coarse source saved in Stripe checkout metadata. Missing, pre-instrumentation or invalid metadata stays `unattributed`; it is not assigned to direct or Google by guessing. This is browser-reported acquisition context, not a causal claim. It carries no analytics client identifier. A checkout reservation freezes the attribution across retries, including when originally absent, so existing Stripe sessions are never rewritten.
