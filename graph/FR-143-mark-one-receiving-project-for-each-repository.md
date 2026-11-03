---
certainty: verified
---

# FR-143: Mark one receiving project for each repository

The system must let the admin of one of the projects that pull issues from a repository mark that project as the one that receives the repository's new issues ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md), [SRC-178](SRC-178-the-receiving-project-is-marked-by-a-project-admin.md)).

A repository has at most one receiving project at a time ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md)). Not stated: what happens when the admin of another project marks theirs while one is already marked.

It serves [UC-009](UC-009-triage-a-task-that-arrived-from-github.md) and [UC-025](UC-025-manage-a-project-s-members.md).

Origin: composed by Claude from the items linked above, for issue #5. After its quality review for issue #11, what happens when the receiving project stops pulling was moved out; FR-157 carries it. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
