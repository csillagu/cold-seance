---
certainty: verified
---

# FR-102: Seed a project from one or more GitHub repositories

The system must import into a project the issues of one or more existing GitHub repositories, with their sub-issue and blocked-by relations, their assignees, and their status from the Projects status field ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)), from repositories the tool can reach on GitHub, through a GitHub App their admin has installed ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)) or a personal access token that reaches them ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)), and whose admin in the tool has approved adding them to the project ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).

It serves [UC-010](UC-010-seed-a-project-from-github-repositories.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Reaching a repository through a personal access token was added by Claude for issue #37 (SRC-229); it awaits the owner's confirmation.
