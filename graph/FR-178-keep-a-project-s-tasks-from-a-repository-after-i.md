---
certainty: assumed
---

# FR-178: Keep a project's tasks from a repository after its approval is withdrawn

When a project's approval for a repository is withdrawn ([FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md)), the system must keep in the project every task it already has from that repository, with every field recorded on it unchanged and its link to its GitHub issue, and must not delete or move any of them ([SRC-190](SRC-190-a-withdrawn-approval-stops-the-project-pulling-its.md), [SRC-217](SRC-217-tasks-kept-after-a-withdrawal-stay-linked-but-are.md)).

It serves [UC-037](UC-037-withdraw-a-project-s-approval-for-a-repository.md).

Origin: split off from FR-172 by Claude for issue #11, after its quality review found it bundled; the owner asked for the split in the design session of 2026-11-03: "Fr172: split." What is kept was made exact from SRC-217 after this item's own review. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
