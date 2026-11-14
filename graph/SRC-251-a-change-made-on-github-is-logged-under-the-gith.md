---
certainty: verified
source: design session
evidence: design session 2026-11-14
---

# SRC-251: A change made on GitHub is logged under the GitHub user's login

When a change arrives from GitHub, the audit log names whoever made it by their GitHub login.

As received, in the design session of 2026-11-14. Asked, on issue #122, "How does the audit log record a change made on GitHub?", with the options "the GitHub user's login, with their account if one is linked", "a built-in GitHub account as the actor, with the GitHub login in the entry's details" and "always only the login, even when the GitHub user is linked to an account", the owner answered: "gh login".

Not stated: whether an account linked to the login is recorded as well; and who is named when the hourly re-check, rather than a webhook, finds a change for which GitHub names no one.
