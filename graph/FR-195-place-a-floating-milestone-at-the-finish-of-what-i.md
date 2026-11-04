---
certainty: assumed
---

# FR-195: Place a floating milestone at the finish of what it is blocked by

The system must place a floating milestone, when it schedules, on the date the last of the tasks it is blocked by finishes, and on no date while nothing it is blocked by has dates ([SRC-236](SRC-236-a-milestone-is-a-kind-of-task-fixed-date-or-floati.md), [DD-030](DD-030-dependencies-have-no-lag.md)).

It serves [UC-021](UC-021-link-tasks-with-constraints.md).

Origin: composed by Claude from the items linked above, for issue #65. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. That the milestone lies on its blockers' last finish day, and not the next working day as a blocked task would start, was Claude's reading of "it takes no time to finish", confirmed by the owner in the design session of 2026-11-04 ([SRC-236](SRC-236-a-milestone-is-a-kind-of-task-fixed-date-or-floati.md)).
