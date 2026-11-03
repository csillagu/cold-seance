---
certainty: assumed
effort: 3
---

# SC-106: GitHub App client

The backend module through which the tool calls GitHub's REST and GraphQL APIs as the App given for each function (reading issues, writing to issues, and the Projects status field): it signs requests for an installation token with that App's private key and uses the token of its installation on each repository ([DD-053](DD-053-each-installation-sets-up-its-own-github-apps-on-a.md)). The GitHub mirror, the change handler, the hourly re-check and the seeding importer call GitHub through it. It is done when each of them can read and write a repository's issues, and the Projects status field, on any repository the App is installed on.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". One App per function was added in the design session of 2026-11-03, from the owner's answers recorded in SRC-205; the effort was estimated before that. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, which the owner confirmed in the design session of 2026-11-02, answering "okay" to the proposed estimates.
