---
certainty: assumed
---

# FR-211: Resize a task's bar on the Gantt by its ends, and freeze a closed task's

The system must let a user drag either end of a task's bar on the Gantt to move only that end, and its middle to move the whole bar: dragging the right end changes the task's duration, dragging the left end changes its planned start and its duration so that its planned finish stays, and dragging the middle changes its planned start and keeps its duration ([SRC-257](SRC-257-a-gantt-bar-is-resized-by-its-ends-moved-by-its-m.md), [FR-144](FR-144-derive-a-task-s-planned-finish-from-its-start-and.md)). A milestone's bar is only moved. The bars of parent tasks, of floating milestones, and of done or cancelled tasks are neither moved nor resized ([SRC-257](SRC-257-a-gantt-bar-is-resized-by-its-ends-moved-by-its-m.md)).

It serves [UC-002](UC-002-reschedule-work-in-a-project.md).

Origin: composed by Claude from the items linked above, for issue #223. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
