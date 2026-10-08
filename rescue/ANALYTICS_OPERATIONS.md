# MinimalPairs business and product measurement

Updated 7 October 2026. This describes implemented events and how to interpret them; it does not claim that every report below has been saved in the Google Analytics UI.

## Sources of truth

- **Search Console:** organic search impressions, clicks, query and landing-page performance. These totals are independent of the site's analytics consent.
- **Google Analytics:** consented browser behavior, acquisition categories, lesson use, diagnostics and checkout intent. Filter to `environment=production` and the current `measurement_version` (`business-funnel-v3`). Earlier releases did not collect the same events reliably.
- **Stripe:** successful paid purchases, active subscriptions, recurring revenue, renewals, cancellations and refunds. A browser checkout event is never a paid conversion. Lifetime sales are one-time revenue, not MRR. Separate historical annual subscriptions from the current monthly/lifetime offer.
- **Private report inbox/audio QA database:** actual recording issues, clip versions and human review decisions. Analytics receives only report language/category and cannot replace this queue.

## Decision reports

Use event-scoped custom dimensions for language, contrast, activity mode, session kind, interface locale, access tier, plan, surface, acquisition channel/source/medium/campaign and return window. Keep random attempt identifiers out of high-cardinality custom dimensions. Use them only for exact session joins in an export when available. Scores, totals, duration and group count are numeric measures.

| Decision | Events and breakdowns | Interpretation |
| --- | --- | --- |
| Which pages attract learners? | `page_view`; approved path, source, medium, campaign, interface locale; compare with Search Console | Page-view counts differ from Search Console clicks and unique people. |
| Do visitors try the product? | `practice_start` / eligible landing visitors; language, activity mode, session kind, access tier | Separate focused, mixed and diagnostic starts; diagnostics also produce their dedicated event. |
| Does audio get learners to answer? | `practice_first_answer` / `practice_start`; `practice_audio_error` by language/contrast/collection | Playback errors count once per round per attempt, not every replay failure. |
| Do learners finish? | `practice_complete` / `practice_start`; `practice_exit`; duration and total rounds | Compare compatible start cohorts and session kinds. Exits are best-effort; cached-page navigation is not a terminal exit. Missing completion alone does not prove a product defect. |
| What needs practice? | `practice_group_complete`; correct/total by language/contrast/mode/session kind | Compute weighted accuracy as sum(correct)/sum(total). Do not average percentages across unequal groups. Group events occur when the whole session completes; incomplete sessions are not a representative accuracy sample. |
| Does the diagnostic lead to lessons? | `diagnostic_start` → `diagnostic_complete` → `diagnostic_results_view` → subsequent practice | The first three share a random attempt ID. Results are recorded when rendered after completion, not proof the visitor read every chart. Diagnostics are sampled listening tasks, not proficiency scores. |
| Are learners returning? | `return_practice`; `return_window`, `days_since_previous`, language, access tier | Gap since the previous consented practice start on this browser, not account-based or calendar-day cohort retention. Same-day repeat sessions are separate from next-day returns. |
| Do recommendations help? | `review_shown` → `review_open` → `review_practice_start` → `review_practice_complete` | Only matching same-tab arrivals followed by a start within 30 minutes are attributed; new-tab and modified clicks are not. |
| Are offers seen and chosen? | `paywall_view`, `plans_view` → `plan_selected`; surface and plan | Views require at least half the locked panel or monthly offer card visible. Late consent can count a currently visible offer. Scroll/rerender callbacks do not duplicate the same exposure. Plan selection includes signed-out intent before sign-in. |
| Does checkout open? | `begin_checkout`, `checkout_error`; plan and surface | `begin_checkout` requires a successful billing handoff after fresh account/access checks. Reopening a pending checkout can produce another handoff. Do not equate it with a unique checkout or purchase. Errors are sanitized, with no provider text. |
| Do people manage memberships? | `billing_portal_open`; Stripe cancellation/renewal records | Portal handoff does not mean cancellation. |
| Are sign-in and support being used? | `login`, `support_submitted`, `audio_report_submitted`; support topic/report reason | Login means an explicit successful Google sign-in, not restored authentication. Reports and support count only acknowledged saves; no submitted message/email/word is included. |
| Are sound guides useful? | `guide_audio_play`; language and approved guide path | Successful completed playback, not merely clicking Play. Interrupted playback is not counted. |
| What do learners tell us? | `practice_feedback`; fixed feedback category, language/contrast/collection | Optional explicit feedback, deduplicated on the page. Treat it as self-selected feedback, not a representative survey. |

Do not sum `practice_start` with `diagnostic_start`, or `practice_complete` with `diagnostic_complete`: diagnostics intentionally appear in both general and specialized funnels. Mixed and diagnostic aggregate events omit a single contrast ID; group events supply the actual contrast and its own score.

## Revenue attribution

After analytics permission, checkout may carry only allowlisted `source`, `medium`, optional `campaign`, and `ui_locale`. The billing service validates them again and stores `mp_source`, `mp_medium`, `mp_campaign`, and `mp_ui_locale` on the Stripe Checkout session. Attribution is frozen with the original pending checkout, so retries cannot rewrite its source. No GA client ID, account ID or raw referring URL is added to these attribution fields. Normal Stripe purchase/account metadata remains separate.

Join confirmed Stripe payments to their Checkout sessions for coarse source/plan revenue summaries. No source metadata means **unattributed**, not necessarily direct. Older sales, declined consent, blocked analytics, owner exclusion and interrupted tracking create legitimate gaps. Metadata already attached to a Stripe purchase follows purchase-record retention; disabling browser analytics does not erase it. Refund/cancellation status must come from Stripe, and analysis does not authorize issuing refunds or canceling customers.

For consistent campaigns use the accepted categories in `app/src/lib/measurement-data.ts`; arbitrary UTM strings are deliberately dropped. Avoid personal identifiers in links. Source categories are retained in same-tab session storage with a 30-minute inactivity limit; they are not a durable cross-device acquisition profile.

## Exclude owner and test traffic

Open `https://minimalpairs.co/analytics-settings?exclude=1` in **each browser profile/device used for ownership or QA**, including the automation browser. Confirm “This browser is excluded.” The setting applies to this origin's tabs. It does not identify the owner on another browser, does not automatically cover the Firebase preview hostname and is removed when site storage is cleared. Repeat on any other origin used for testing.

Localhost and browsers declaring WebDriver are excluded automatically; native browser automation may not declare WebDriver and needs the explicit switch. Removing exclusion does not grant consent. Keep preview/developer data filtered separately. Exclusion is prospective and cannot clean historical traffic already received.

## Privacy and configuration checks

Analytics loads only after opt-in and stays off under Do Not Track/Global Privacy Control or exclusion. Revocation clears pending attribution, active measured attempts, return timestamps and GA cookies. Late opt-in never fabricates a practice start or completion for an already-running unmeasured session. No raw words, support messages, emails, account/payment identifiers, error text, query strings or full referrers are in custom event payloads.

Disable GA enhanced-measurement form interactions, outbound links, site-search and automatic history-based page views, along with unwanted other automatic events: those can bypass the custom event payload allowlist. Keep Google Signals and advertising personalization off. Verify property settings independently; source code alone cannot prove remote settings. Advertising consent remains denied. Do not register purchase as a client-inferred event or use checkout return URLs as payment confirmation.

## Verification and operating cadence

- Before release: `cd rescue/app && npm run check`, then `node --test tests/measurement.test.mjs tests/component-measurement.test.mjs`; run the billing attribution tests when changing checkout metadata.
- Use a dedicated test environment/property for event validation. Do not disable production owner exclusion merely to generate sample traffic. Tests mock transports and do not purchase or send support messages.
- After release: inspect production event presence, appropriate language/mode/plan values, no automatic sensitive parameters, and consent/exclusion behavior. GA display delays and blockers mean a queued event is not delivery confirmation.
- Daily initially: check playback failures, support/report queue, checkout errors and confirmed Stripe sales. Review the exact flagged recordings in the QA queue, not inferred analytics scores.
- Weekly: compare acquisition → starts → first answer → completion, then offer views → selections → checkout handoffs and separately confirmed Stripe revenue. Segment language, mode, locale and access tier before deciding what to change. With small counts, report raw numerators/denominators and avoid declaring a price or design winner.

No retrospective reconstruction is possible for missing historical tracking. This setup measures consenting browsers, not all visitors, real identities, unique customers or complete cross-device learning. Cleared storage, blockers, consent changes, retries and interrupted navigation affect denominators. Keep those limitations beside any revenue or retention claim.

## Verified configuration at this release (7 October 2026 Chicago)

- Property `556274368`, stream `15861635108`, tag `G-82W1PVNSFS`; stream renamed **MinimalPairs production**, URL `https://minimalpairs.co`.
- Eight added event dimensions: practice mode, session kind, membership plan, product surface, interface language, access tier, practice return window, measurement version. Eighteen total definitions now registered.
- Three custom metrics: `correct` (standard), `total` (standard), `duration_ms` (milliseconds). Always filter to one compatible completion event type before summing.
- `diagnostic_complete` and `begin_checkout` registered as key events without default monetary values. Existing `purchase` definition remains but this release does not send client-inferred purchases.
- Enhanced measurement verified OFF; **Preview and developer traffic** exclusion verified ACTIVE. The pre-existing IP-based Internal Traffic rule is only Testing; owner exclusion is instead enforced in the application before tag loading.
- [Saved practice activation funnel](https://analytics.google.com/analytics/web/#/analysis/a199724961p556274368/edit/9S4ynw_dSpWeDsYB_ryKTg): page view → practice start → first answer → completion, filtered to `measurement_version=business-funnel-v3`. This is a consenting-browser funnel, not a same-attempt join. Its rolling date range initially has no new-version data; allow fresh traffic/report processing before interpreting it. Diagnostic starts are included in overall practice activation.
- Codex in-app browser exclusion confirmed on both production and Firebase hostnames. Other owner browsers/devices must open the exclusion link separately.
- Billing deployment `cc006acb-b575-4d5d-9459-b05cebcab92f` verified serving 100%; authenticated endpoint rejects unauthenticated requests as expected. No test charges or customer communications were performed.
