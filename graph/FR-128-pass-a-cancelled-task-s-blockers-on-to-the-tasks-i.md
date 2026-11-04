---
certainty: verified
---

# FR-128: Pass a cancelled task's blockers on to the tasks it blocked

When a task is cancelled, the system must make each task it blocked blocked by whatever the cancelled task was blocked by ([SRC-159](SRC-159-what-cancelling-a-task-does.md)). This includes a milestone of another project, even if the person cancelling cannot read that project ([SRC-241](SRC-241-a-cancelled-task-s-blockers-are-passed-on-whateve.md)).

It serves [UC-022](UC-022-cancel-a-task.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. The sentence on another project's milestone was added for issue #85, from the owner's answer in the design session of 2026-11-04.
