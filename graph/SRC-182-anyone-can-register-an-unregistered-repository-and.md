---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-182: Anyone can register an unregistered repository and becomes its admin, for now

For now, anyone can register a repository that the GitHub App has access to ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)) and that nobody has registered yet ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)). Whoever registers it becomes its admin: first come, first served. How repository admins are appointed is a question for the next release.

As received: "How repositories admins are appinted js a question for the next release, at the moment, anyone can register a previously unregistered repo, the gh app has access to and they become admin." The drafting agent pointed out that first come, first served lets someone with no access to a repository on GitHub register it and approve it into their own project, and proposed making whoever installed the GitHub App on the repository its first admin. The stakeholder answered: "To be honest in many orgs that cannot be done. Do first come first served for now, sys admins can change repository admins (in the tool) so nothing bad can happen. Later, we will do something like you proposed."

"Anyone" is read as anyone with an account, since nobody can use the tool without one ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).
