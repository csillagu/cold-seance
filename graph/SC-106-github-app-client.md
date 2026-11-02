---
certainty: assumed
---

# SC-106: GitHub App client

The backend module through which the tool calls GitHub's REST and GraphQL APIs as the App: it signs requests for an installation token with the App's private key and uses the token of the installation on each repository ([DD-053](DD-053-each-installation-creates-its-own-github-app-from.md)). The GitHub mirror, the change handler, the hourly re-check and the seeding importer call GitHub through it. It is done when each of them can read and write a repository's issues, and the Projects status field, on any repository the App is installed on.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
