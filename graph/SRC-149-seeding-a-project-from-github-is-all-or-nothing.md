---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-149: Seeding a project from GitHub is all or nothing

Seeding a project from GitHub repositories ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)) works like a transaction: either everything in the import succeeds, or the whole import fails.

As received, asked what should happen when seeding fails, for example when a repository is not accessible or the import stops part-way: "this should be like s transaction. Everything suvvessful or everything fails".

Asked whether an issue that is already a task in another project, an import repeated for the same repository, or an issue blocked by one outside the chosen repositories counts as a failure: "no".
