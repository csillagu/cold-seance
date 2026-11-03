---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-232: The system admin is notified of an expired or revoked token

When a personal access token the tool uses ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)) has expired or been revoked, the tool notifies the system admin.

As received, in the design session of 2026-11-03, asked "Expired or revoked token: how should the tool report it?": "notification to the sys admin".

"The sys admin" is read as every system admin, since there may be several. The reading is Claude's; the owner confirmed it later in the same session: "proposals confirmed, mark DD-060 confirmed". Not stated: whether the same holds for a GitHub App whose key is revoked or which is uninstalled, and how often the notification repeats while the token stays unusable.
