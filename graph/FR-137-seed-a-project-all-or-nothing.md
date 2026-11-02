---
certainty: assumed
---

# FR-137: Seed a project all or nothing

The system must complete a seeding import entirely or not at all: if any part of it fails, the import fails as a whole and brings nothing in ([SRC-149](SRC-149-seeding-a-project-from-github-is-all-or-nothing.md)).

An issue that is already a task in another project, an import repeated for the same repository, and an issue blocked by one outside the chosen repositories do not count as failures ([SRC-149](SRC-149-seeding-a-project-from-github-is-all-or-nothing.md)).

Not stated: what the import does in each of these three cases.

It serves [UC-010](UC-010-seed-a-project-from-github-repositories.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
