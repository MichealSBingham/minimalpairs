# Email audience intake — review build

This isolated service has not been deployed. Intake defaults off. It has **no delivery code**, no provider credential, no scheduler, and no way to send to subscribers. Confirmation can mark a record verified but never starts delivery. `SENDING_ENABLED` is an explicit deployment marker; changing it cannot send mail.

Run checks: `node --test rescue/email-course-service/worker.test.mjs`.

## API

- `POST /subscribe`: JSON `email`, `language`, `course` boolean, `weekly` boolean, `consentVersion: "listening-course-2026-10-09-v1"`. At least one choice must be explicitly true; both fields are mandatory. Accepted records are **pending-verification** until confirmed. Duplicate submissions return the same response without changing consent or resurrecting suppression. No email existence or unsubscribe capability is exposed.
- `POST /unsubscribe`: JSON `token` (64 hex characters). Suppresses both course and weekly email. Unknown tokens receive the same success response. GET on the action endpoint returns405 and never mutates state. GET `/unsubscribe/confirm#TOKEN` serves the confirmation page; clicking submits POST. Tokens stay in the fragment and are removed from the address bar on load.
- `GET /admin/subscribers`: Bearer `ADMIN_TOKEN`; private export includes only email, language, consent choices/version/timestamp and subscription state. No tokens/IPs. Treat the export as private operational data.

Origin allowlist: minimalpairs.co, www.minimalpairs.co, minimalpairs.web.app. CORS is not authentication; subscription email ownership remains unverified until its confirmation token is submitted.

Storage is capped at5,000 addresses plus token indexes. Unsubscribed records remain suppressed. The bounded rate map rotates daily and accepts at most5 submissions per day-scoped salted IP hash, with5,000 hash buckets maximum. Raw IP addresses are not stored or logged. Cloudflare receives connection metadata in ordinary request processing; do not claim anonymous processing end to end.

Secrets, if approved for deployment: independent high-entropy `ADMIN_TOKEN` and `RATE_SECRET`, provisioned through Wrangler secret storage. No new keys were created for this build. Observability, preview URLs and workers.dev default off. No frontend currently calls this service.

## Required before launch

1. Approve exact course messages, brand template, subscription copy and confirmation email. Proposed copy: “Email me the three-part listening course for my selected language.” Separate unchecked choice: “Also send me a weekly listening tip. I can unsubscribe at any time.” Update version if the actual copy changes; retain the approved text beside the version.
2. Connect the approved confirmation email to the existing48-hour single-use verification capability. GET `/confirm#TOKEN` only presents a confirmation button; POST `/confirm` verifies, rejecting expired/replayed tokens. No delivery starts. Tokens are internal only, absent from admin export. Pending records expire after7 days through a daily Durable Object alarm; email and tokens are removed, minimized consent audit retained30 days with a5,000-entry cap. Suppressed and verified records are preserved.
3. Connect the frontend signup consent form to the service; validate actual domains, privacy notice, postal footer and accessibility. Confirmation and unsubscribe pages are implemented with token fragments, no-referrer and restrictive CSP. Cookie rejection must not preselect or prevent voluntary email subscription.
4. Add delivery only after owner approval: idempotent outbox, provider bounces/complaints suppression with authenticated webhooks, global frequency and provider cost caps, receipt/access-message priority, and rechecking paid status before any upgrade message. The future sender must honor suppressed state at send time.
5. Review operator workflow: POST `/admin/preferences` requires Bearer admin auth, explicit choices/version and consent evidence. It updates only verified unsuppressed records, appends audit, and cannot restore suppressed records. Both choices false suppresses. Each subscriber is capped at100 preference audit entries before operator archival. POST `/admin/cleanup` allows authenticated cleanup on demand. Establish an approved user-data deletion/retention procedure before broad rollout.
6. Verify free-plan availability and bind an explicit route after approval. Perform provider integration tests before enabling intake. Never deploy this placeholder as a working email course or promise that an accepted submission will receive mail yet.

The separate preview and sequence policy live in `../company/email-course/`. This module does not import existing Stripe/Firebase users or existing support contacts.
