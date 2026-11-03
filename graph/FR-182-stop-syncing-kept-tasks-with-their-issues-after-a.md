---
certainty: assumed
---

# FR-182: Stop syncing kept tasks with their issues after a withdrawal

For the tasks a project keeps after its approval for a repository is withdrawn ([FR-178](FR-178-keep-a-project-s-tasks-from-a-repository-after-i.md)), the system must switch off syncing with their GitHub issues in both directions, as one capability: it neither writes their planning to the issues nor takes status changes from them ([SRC-217](SRC-217-tasks-kept-after-a-withdrawal-stay-linked-but-are.md)).

It serves [UC-037](UC-037-withdraw-a-project-s-approval-for-a-repository.md).

Origin: composed by Claude from the items linked above, for issue #11, from SRC-217. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
