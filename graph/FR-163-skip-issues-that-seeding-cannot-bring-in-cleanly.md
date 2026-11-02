---
certainty: verified
---

# FR-163: Skip issues that seeding cannot bring in cleanly

During seeding, the system must skip an issue that is already a task in another project, an issue already brought in by an earlier import of the same repository, and an issue blocked by one outside the chosen repositories ([SRC-179](SRC-179-seeding-skips-issues-it-cannot-bring-in-cleanly.md)).

It serves [UC-010](UC-010-seed-a-project-from-github-repositories.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
