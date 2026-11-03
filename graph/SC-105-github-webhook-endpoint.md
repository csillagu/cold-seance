---
certainty: assumed
effort: 2
---

# SC-105: GitHub webhook endpoint

The Fastify route ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)) that receives the webhook deliveries of the GitHub Apps that send them, and of the webhooks set up on repositories and organizations ([DD-060](DD-060-a-github-function-is-given-an-app-or-a-personal-ac.md)), rejects any delivery whose signature does not match the webhook secret configured for the App that sent it, or the one secret configured for repository and organization webhooks, and hands each accepted one to the GitHub change handler ([DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md)). Webhooks are optional: a delivery from an App with no webhook secret configured is rejected, and so is a delivery from a repository or organization webhook while no secret is configured for them. It is done when a signed delivery reaches the change handler and an unsigned or wrongly signed one, or one from an App, or from a repository or organization webhook, with no secret configured, is rejected without any effect.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". Making webhooks optional and checking each App's own secret were added in the design session of 2026-11-03 (SRC-209). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, which the owner confirmed in the design session of 2026-11-02, answering "okay" to the proposed estimates. Repository and organization webhooks were added by Claude for issue #37 (SRC-230, DD-060); they await the owner's confirmation, and whether the confirmed effort still holds with them awaits the owner.
