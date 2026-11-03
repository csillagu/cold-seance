---
certainty: verified
negotiability: immovable
source: design session
evidence: design session 2026-11-03
---

# SRC-209: GitHub webhooks are optional, beside the hourly re-check

Receiving changes from GitHub through webhooks is an option the installation may use, beside the hourly re-check ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)); it is not required.

As received, in the design session of 2026-11-03, told why an App's webhook secret matters: "Webhook: this should be an option to use, along the hourly poll. But not a must. Also, we mist create an endpoint, the webhook to return to, so i dont see why the user would need to type anything in?"
