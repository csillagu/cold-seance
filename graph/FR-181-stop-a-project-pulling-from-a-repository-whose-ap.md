---
certainty: assumed
---

# FR-181: Stop a project pulling from a repository whose approval is withdrawn

Once a project's approval for a repository is withdrawn ([FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md)), the system must add no issue from that repository to the project from the moment the withdrawal is recorded; issues it already holds as tasks stay, as FR-178 requires ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md), [SRC-169](SRC-169-a-project-sets-which-repositories-it-pulls-issues.md), [SRC-190](SRC-190-a-withdrawn-approval-stops-the-project-pulling-its.md)).

It serves [UC-037](UC-037-withdraw-a-project-s-approval-for-a-repository.md).

Origin: composed by Claude from the items linked above, for issue #11, split off from FR-172 after its quality review. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
