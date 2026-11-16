---
certainty: assumed
---

# FR-212: Make a new task with a duration of 0 a milestone

The system must, when a user creates a task through the UI with a duration of 0, create it as a milestone ([SRC-258](SRC-258-a-new-task-with-a-duration-of-0-is-a-milestone.md), [FR-190](FR-190-let-a-task-be-made-a-milestone-with-a-fixed-date-o.md)): pinned to the planned start given, or floating when no planned start is given. While the duration is 0, the form must not offer the fields a milestone cannot have ([FR-191](FR-191-keep-a-milestone-without-duration-effort-or-ai-sha.md), [FR-192](FR-192-reject-assignees-and-an-eligibility-expression-on.md)). A task that already exists cannot be given a duration of 0, since it cannot become a milestone ([FR-194](FR-194-keep-a-task-s-kind-and-a-milestone-s-variant-uncha.md)).

It serves [UC-001](UC-001-plan-a-task-in-a-project.md).

Origin: composed by Claude from the items linked above, for issue #227. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. That the planned start is the field that gives the fixed date, and that an existing task keeps refusing a duration of 0, are Claude's reading and await the owner's confirmation.
