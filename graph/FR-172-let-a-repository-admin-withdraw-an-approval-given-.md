---
certainty: assumed
---

# FR-172: Let a repository admin withdraw an approval given to a project

The system must let any admin of a repository withdraw an approval given earlier for adding the repository to a project, and must then stop the project pulling issues from the repository ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md), [SRC-169](SRC-169-a-project-sets-which-repositories-it-pulls-issues.md)). The project keeps the tasks it already has from the repository ([SRC-190](SRC-190-a-withdrawn-approval-stops-the-project-pulling-its.md)).

When the project is the repository's receiving project ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md)), it thereby stops receiving the repository's new issues ([SRC-190](SRC-190-a-withdrawn-approval-stops-the-project-pulling-its.md)). Not stated: which project, if any, then receives them.

It serves [UC-037](UC-037-withdraw-a-project-s-approval-for-a-repository.md).

Origin: composed by Claude from the items linked above, for issue #7. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
