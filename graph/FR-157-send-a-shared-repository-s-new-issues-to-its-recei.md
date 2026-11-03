---
certainty: verified
---

# FR-157: Send a shared repository's new issues to its receiving project

Where several projects pull issues from the same repository ([SRC-174](SRC-174-several-projects-can-pull-issues-from-the-same-rep.md)), the system must add a new issue from it to the repository's receiving project only ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md), [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md)). When the repository's receiving project has stopped pulling issues from it, the system must add its new issues to no project ([SRC-215](SRC-215-after-the-receiving-project-stops-pulling-no-p.md)).

It serves [UC-009](UC-009-triage-a-task-that-arrived-from-github.md).

Origin: composed by Claude from the items linked above, for issue #5; the case of no receiving project was added for issue #11 from SRC-215. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
