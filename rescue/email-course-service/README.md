# Email audience intake — review build

This isolated service is deployed inactive. Intake defaults off. It contains a persistent outbox and Resend delivery adapter, but no provider credential or approved templates. Both global activation and exact approved template configuration are required. Intake and sending default off.

Run checks: `node --test rescue/email-course-service/*.test.mjs`.

## API

- `POST /subscribe`: JSON `email`, `language`, `course` boolean, `weekly` boolean, `consentVersion: "listening-course-2026-10-09-v1"`. At least one choice must be explicitly true; both fields are mandatory. Accepted records are **pending-verification** until confirmed. Duplicate submissions return the same response without changing consent or resurrecting suppression. No email existence or unsubscribe capability is exposed.
- `POST /unsubscribe`: JSON `token` (64 hex characters). Suppresses both course and weekly email. Unknown tokens receive the same success response. GET on the action endpoint returns405 and never mutates state. GET `/unsubscribe/confirm#TOKEN` serves the confirmation page; clicking submits POST. Tokens stay in the fragment and are removed from the address bar on load.
- `GET /admin/subscribers`: Bearer `ADMIN_TOKEN`; private export includes only email, language, consent choices/version/timestamp and subscription state. No tokens/IPs. Treat the export as private operational data.

Origin allowlist: minimalpairs.co, www.minimalpairs.co, minimalpairs.web.app. CORS is not authentication; subscription email ownership remains unverified until its confirmation token is submitted.

Storage is capped at5,000 addresses plus token indexes. Unsubscribed records remain suppressed. The bounded rate map rotates daily and accepts at most5 submissions per day-scoped salted IP hash, with1,000 hash buckets maximum (bounded under the per-value storage limit). Raw IP addresses are not stored or logged. Cloudflare receives connection metadata in ordinary request processing; do not claim anonymous processing end to end.

Secrets, if approved for deployment: independent high-entropy `ADMIN_TOKEN` and `RATE_SECRET`, provisioned through Wrangler secret storage. Isolated admin/rate secrets are provisioned. Observability and preview URLs are off; workers.dev hosts the inactive endpoint. The frontend integration remains hidden behind its approval flag.

## Required before launch

1. Approve exact course messages, brand template, subscription copy and confirmation email. Proposed copy: “Email me the three-part listening course for my selected language.” Separate unchecked choice: “Also send me a weekly listening tip. I can unsubscribe at any time.” Update version if the actual copy changes; retain the approved text beside the version.
2. Connect the approved confirmation email to the existing48-hour single-use verification capability. GET `/confirm#TOKEN` only presents a confirmation button; POST `/confirm` verifies, rejecting expired/replayed tokens. No delivery starts. Tokens are internal only, absent from admin export. Pending records expire after7 days through an hourly Durable Object alarm; email and tokens are removed, minimized consent audit retained30 days with a5,000-entry cap. Suppressed and verified records are preserved.
3. Connect the frontend signup consent form to the service; validate actual domains, privacy notice, postal footer and accessibility. Confirmation and unsubscribe pages are implemented with token fragments, no-referrer and restrictive CSP. Cookie rejection must not preselect or prevent voluntary email subscription.
4. Configure delivery only after owner approval: RESEND_API_KEY, FROM_ADDRESS, PUBLIC_ORIGIN, DAILY_SEND_CAP and APPROVED_TEMPLATE_SHA256. The small approval variable must exactly equal bundled templates.unapproved.json sourceSha256; otherwise no copy is sendable. Templates are bundled in the worker rather than stored in a large secret. Persistent jobs have stable idempotency keys; ambiguous failures are held for operator reconciliation, never blindly retried. Budget is reserved before network calls, capped at50 per UTC day maximum (default0), leaving capacity for existing account/support mail. Marketing is spaced48h per recipient. Promotional templates are refused outright; neutral lessons work equally for buyers/nonbuyers until a fresh billing-aware personalization implementation is separately approved.
5. Review operator workflow: POST `/admin/preferences` requires Bearer admin auth, explicit choices/version and consent evidence. It updates only verified unsuppressed records, appends audit, and cannot restore suppressed records. Both choices false suppresses. Each subscriber is capped at100 preference audit entries before operator archival. POST `/admin/cleanup` allows authenticated cleanup on demand. Establish an approved user-data deletion/retention procedure before broad rollout.
6. Verify free-plan availability and bind an explicit route after approval. Perform provider integration tests before enabling intake. Never deploy this placeholder as a working email course or promise that an accepted submission will receive mail yet.

The separate preview and sequence policy live in `../company/email-course/`. This module does not import existing Stripe/Firebase users or existing support contacts.

## Delivery operator API

POST `/admin/queue` (admin Bearer) accepts id, subscriberKey, templateId, kind (confirmation/course/weekly/neutral), dueAt. Intake automatically queues confirmation-v1 but it cannot send without approved configured copy. POST `/admin/deliver` runs one job; hourly alarms also process one when enabled. Outbox is capped5,000 records and needs explicit archival when full. Outcomes sending/uncertain are deliberately held for provider reconciliation; restarting cannot double-send them. Confirmed acceptance is not inbox delivery.

POST `/admin/provider-event` requires independent PROVIDER_EVENT_TOKEN from a trusted operator relay and accepts providerId/type bounce or complaint. It suppresses only a recipient linked to an accepted send. Native POST `/webhooks/resend` verifies raw-payload Svix HMAC-SHA256 using RESEND_WEBHOOK_SECRET, with a five-minute timestamp window. Set that secret and register the endpoint for bounced/complained events. No relay is required; the admin endpoint remains an operator fallback. Duplicate events are idempotent.

No live emails or subscriber imports were performed. Twenty-two local tests cover consent, confirmation, suppression, quotas, delivery idempotency and ambiguous-outcome holds. See the deployed-state section below.

Confirmation automatically queues course-day0, course-day3 and course-day7 jobs when course consent is true. Localized template keys use `course-day0:fr` etc, falling back to the common id only if configured. Template preparation consumes neutral paragraphs only; member/free upsell paragraphs are deliberately omitted for everyone. There is no pending paid-status dependency in course delivery. All source template approvals remain false until owner approval.

Signature implementation and official test vector: https://docs.svix.com/receiving/verifying-payloads/how-manual . Raw body is verified unchanged via WebCrypto HMAC. Native webhook endpoint is registered with Resend for bounced and complained events, with its signing secret encrypted in the Worker.

Free-plan configuration uses `new_sqlite_classes`, which is supported on Workers Free; quota exhaustion fails rather than charging overages on that plan. Existing account plan still must be checked by the deployer. Source: https://developers.cloudflare.com/durable-objects/platform/pricing/ . No plan change was made.

`node prepare-templates.mjs` produces templates.unapproved.json from the exact owner-preview copy and records its SHA256. It generates28 disabled templates (three per nine banks plus confirmation), no promotional variants. Deployment can occur inactive without API credentials; activation requires the exact approved template source digest and explicit nonzero quota.

## Deployed inactive — October 9, 2026 UTC

Cloud endpoint: https://minimalpairs-email-course.sirmichealbingham.workers.dev . Code version `75067940-3db3-4474-ac12-258150ffe851`, followed by an encrypted webhook-secret deployment. Intake=false, sending=false, daily cap=0. Independent admin/rate secrets are encrypted in Worker secrets and backed up only in ignored private storage. The existing sending-only Resend key and dedicated webhook signing secret are encrypted in this service. No template approval digest or postal address is set. No recipients imported, no emails sent. HTTP checks: disabled subscribe503, unauthenticated admin401, authenticated export200 with zero subscribers, unsigned provider event401.

The optional account and completed-diagnostic forms are implemented for nine production banks, but compiled out unless PUBLIC_EMAIL_COURSE_APPROVED=true and a HTTPS PUBLIC_EMAIL_COURSE_ENDPOINT are configured. The exact27 messages plus confirmation can be reviewed in ../company/email-course/index.html; templates.sha256 identifies that draft set. Activation requires owner approval of that copy and a valid postal footer, then provider credentials/webhook registration and a nonzero approved cap. Those are release configuration and approval gates, not permission to send now.

No paid plan was enabled. The service deployed using existing account access and the Free-compatible SQLite configuration. The account subscriptions API returned403 under limited OAuth scope; the authenticated Cloudflare dashboard subsequently verified Free $0 as the current Workers plan. Intake and delivery remain closed regardless.

Latest checks:23 backend tests, including concurrent per-recipient spacing reservation, prefixed provider idempotency, signed webhook replay handling and uncertain-send holds. Branded escaped HTML is sent alongside plain text. Never interpret accepted delivery as inbox placement.

Provider webhook ID: `c69f4e99-223d-4dc5-8baf-b474eea6eda5`, only email.bounced/email.complained. Sending-only scope verified by provider restricted_api_key response on management GET. No test email sent. Activation now requires only the owner-approved exact template digest and postal footer, then explicitly enabling the hidden form, intake, delivery and a small quota.
