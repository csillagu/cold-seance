---
certainty: assumed
actor: Project member with the contributor role
---

# UC-029: Set the status of a task I am assigned to

## Goal

Report progress on a task the actor is assigned to by setting its status in the tool.

## Preconditions

- The actor has the contributor role in the task's project ([SRC-136](SRC-136-contributor-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The actor is assigned to the task ([SRC-136](SRC-136-contributor-role.md), [SRC-032](SRC-032-assignment-is-a-concrete-list-of-people.md)).

## Steps

1. The actor opens a view that shows the task, covering its own project or several projects ([SRC-008](SRC-008-four-view-kinds-cover-manual-use.md), [SRC-110](SRC-110-a-view-shows-only-the-tasks-its-viewer-can-read.md), [SRC-138](SRC-138-a-cross-project-view-allows-whatever-the-viewer-ca.md)).
2. They mark the task as in progress, on hold or finished ([SRC-136](SRC-136-contributor-role.md)).

## Success criteria

- The task shows its new status ([SRC-136](SRC-136-contributor-role.md)).
- Marking it in progress records its actual start; marking it finished records its actual finish ([SRC-055](SRC-055-actual-start-is-recorded-when-a-task-is-started.md), [SRC-056](SRC-056-actual-finish-is-recorded-when-a-task-is-finished.md)).
- Putting it on hold only marks the task: its planned finish and its load stay as they were ([DD-007](DD-007-hold-only-marks-a-task.md)).

## Failure modes

- A parent cannot be finished while one of its subtasks is open ([SRC-020](SRC-020-subtask-parent-child-constraint.md)).
- A blocked task cannot start before its blocker finishes ([SRC-021](SRC-021-blocked-by-blocking-constraint.md)).
- The actor cannot set the status of a task they are not assigned to ([SRC-136](SRC-136-contributor-role.md)).
- The actor cannot edit the task's other fields, cancel it, or reopen it once finished ([SRC-136](SRC-136-contributor-role.md)).

Origin: composed by Claude from the items linked above, after the stakeholder described this use case in the design session. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
