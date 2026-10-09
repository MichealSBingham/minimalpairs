# Single-step email-course intake — inactive review build

Selecting “Send my listening plan” explicitly subscribes to three course emails. The optional weekly checkbox is unchecked. No confirmation email is generated; ownership is not claimed as verified. Status is `subscribed`, with explicit consent version `listening-course-2026-10-09-v2`.

Intake and sending remain off until exact copy and launch configuration are approved. POST /subscribe retains separate course/weekly booleans, origin/rate/storage limits, idempotent duplicate response and suppression protection. Signup queues day0/3/7 only when course=true. Old confirmation jobs are ineligible; legacy verified records remain eligible. Existing legacy pending cleanup and confirmation endpoints are retained only for compatibility.

Unsubscribe remains a one-action POST behind the email's fragment-token link. New requests never resurrect suppressed recipients. The admin preference endpoint requires authenticated documented consent evidence. Delivery has no open pixel enabled by this change.

Run `node --test rescue/email-course-service/*.test.mjs`. Exact templates and digest are in ../company/email-course; generated backend bundle contains27 unapproved course messages. No confirmation template remains. Before activation configure approved copy digest, domain sender, postal address, provider secrets, unsubscribe origin, daily cap and suppression webhook. New single-step submissions are susceptible to mistyped or third-party addresses; rate limits, visible unsubscribe and bounce/complaint suppression remain essential.
