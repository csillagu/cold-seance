---
certainty: assumed
---

# FR-032: Derive a task's default person-load percentage from its AI share

The system must give each task a person-load percentage of 100% minus its AI share: 100% for a normal task, 50% for a 50% AI task ([SRC-038](SRC-038-person-load-by-task-type-and-ai-share.md), [DD-009](DD-009-person-load-is-a-percentage-applied-over-the-task.md)). Two 50% AI tasks can therefore be done at the same time ([SRC-100](SRC-100-two-50-ai-tasks-can-be-done-at-the-same-time.md)).

It serves [UC-003](UC-003-assign-people-to-a-task.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
