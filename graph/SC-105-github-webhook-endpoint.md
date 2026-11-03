---
certainty: assumed
effort: 2
---

# SC-105: GitHub webhook endpoint

The Fastify route ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)) that receives the webhook deliveries of the GitHub Apps that send them, rejects any delivery whose signature does not match the webhook secret configured for the App that sent it, and hands each accepted one to the GitHub change handler ([DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md)). Webhooks are optional: a delivery from an App with no webhook secret configured is rejected. It is done when a signed delivery reaches the change handler and an unsigned or wrongly signed one, or one from an App with no secret configured, is rejected without any effect.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". Making webhooks optional and checking each App's own secret were added in the design session of 2026-11-03 (SRC-209). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, which the owner confirmed in the design session of 2026-11-02, answering "okay" to the proposed estimates.
