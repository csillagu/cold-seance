---
certainty: assumed
effort: 3
---

# SC-106: GitHub client

The backend module through which the tool calls GitHub's REST and GraphQL APIs: for each call it takes the token for the call's function (reading issues, writing to issues, or the Projects status field) on the call's repository: for a function given an App, the token of that App's installation, from the GitHub App tokens component ([SC-108](SC-108-github-app-tokens.md), [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md)); for a function given a personal access token, that token ([DD-060](DD-060-a-github-function-is-given-an-app-or-a-personal-ac.md)). The GitHub mirror, the change handler, the hourly re-check and the seeding importer call GitHub through it. It is done when each of them can read and write a repository's issues, and the Projects status field, on any repository the App or token given for each function reaches, with Apps and tokens mixed across functions, and when it reports which function's token cannot reach a repository the tool needs, and which function's personal access token GitHub refuses as expired or revoked, for the notification of the system admins.

It delivers:

- [FR-185](FR-185-call-github-for-each-function-with-the-app-or-the.md): Call GitHub for each function with the App or the token given for it
- [FR-186](FR-186-notify-every-system-admin-when-a-personal-access-t.md): Notify every system admin when a personal access token stops working

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". In the design session of 2026-11-03 one App per function was added (SRC-207) and, following its quality review, signing and token handling were split off into SC-108. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: the owner confirmed 3 for the whole client in the design session of 2026-11-02 ("okay"); after the split, 2 is Claude's estimate for this part. The owner confirmed it in the design session of 2026-11-03: "Efforts ok". Personal access tokens, mixed with Apps across functions, were added by Claude for issue #37 (SRC-229, DD-060), and the name changed from "GitHub App client" with them; the file keeps its old name so that existing links hold. Asked whether the effort should rise from 2 to 3 with tokens added, the owner answered in the same session: "6 ok". Reporting a refused token was added afterwards (SRC-232); it awaits the owner's confirmation.
