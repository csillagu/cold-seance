---
certainty: assumed
effort: 2
---

# SC-106: GitHub App client

The backend module through which the tool calls GitHub's REST and GraphQL APIs: for each call it takes, from the GitHub App tokens component ([SC-108](SC-108-github-app-tokens.md)), the token of the App given for the call's function (reading issues, writing to issues, or the Projects status field) on the call's repository ([DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md)). The GitHub mirror, the change handler, the hourly re-check and the seeding importer call GitHub through it. It is done when each of them can read and write a repository's issues, and the Projects status field, on any repository the Apps are installed on.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". In the design session of 2026-11-03 one App per function was added (SRC-207) and, following its quality review, signing and token handling were split off into SC-108. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: the owner confirmed 3 for the whole client in the design session of 2026-11-02 ("okay"); after the split, 2 is Claude's estimate for this part, awaiting the owner's confirmation.
