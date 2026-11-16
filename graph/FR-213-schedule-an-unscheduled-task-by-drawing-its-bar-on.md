---
certainty: assumed
---

# FR-213: Schedule an unscheduled task by drawing its bar on the Gantt

The system must let a user who can edit an unscheduled task give it dates on the Gantt by drawing its bar on the task's lane, dragged either way by whole days, the earlier day being its start ([SRC-259](SRC-259-an-unscheduled-task-is-scheduled-by-drawing-its-ba.md), [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md)). While the bar is drawn, the system must show its start, its finish and its length in working days, and scroll the timeline when the pointer nears its edge. A drawn bar must store the task's planned start and a duration of the working days it covers, not its planned finish, which is derived from them ([FR-144](FR-144-derive-a-task-s-planned-finish-from-its-start-and.md)). A fixed-date milestone with no date must be placed on the day clicked on its lane ([SRC-259](SRC-259-an-unscheduled-task-is-scheduled-by-drawing-its-ba.md)).

A plain click, Escape while drawing and letting go off the lane must change nothing. The lanes of done and cancelled tasks and of floating milestones must not be drawn on. Until the change is saved, the bar must be shown as pending; if it is refused, the bar must go away and the refusal be shown. Once saved, the task must move up into the scheduled rows and stay selected, and its new dates must be announced to screen readers ([SRC-259](SRC-259-an-unscheduled-task-is-scheduled-by-drawing-its-ba.md)).

It serves [UC-001](UC-001-plan-a-task-in-a-project.md).

Origin: composed by Claude from the items linked above, for issue #228. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
