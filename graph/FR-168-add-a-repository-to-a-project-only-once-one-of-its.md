---
certainty: verified
---

# FR-168: Add a repository to a project only once one of its admins approves

The system must add a repository to a project only once one of the repository's admins has approved adding it to that project, whether to seed the project from it or to pull its issues; one admin's approval is enough ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)). A repository that is not registered has no admin ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)), so it cannot be added to a project.

It serves [UC-034](UC-034-approve-adding-a-repository-to-a-project.md) and [UC-010](UC-010-seed-a-project-from-github-repositories.md).

Origin: composed by Claude from the items linked above, for issue #7. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
