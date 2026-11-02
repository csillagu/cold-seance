---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-179: Seeding skips issues it cannot bring in cleanly

When seeding a project ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)), the import skips an issue that is already a task in another project, an issue already brought in by an earlier import of the same repository, and an issue blocked by one outside the chosen repositories ([SRC-149](SRC-149-seeding-a-project-from-github-is-all-or-nothing.md)).

As received, asked what the import does in these three cases, which do not count as failures: "It skips those". That "skips" means the issue is left out of the import is the drafting agent's reading.
