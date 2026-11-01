---
actor: Project member with the read-write role
---

# UC-007: Track task status in the tool

## Goal

Keep the day-to-day status of tasks current in the tool.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).

## Steps

1. The actor opens a Kanban, whose columns follow task status ([SRC-009](SRC-009-kanban-view.md)).
2. They move a task's card to start it, put it on hold or finish it ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
3. Starting records the task's actual start; finishing records its actual finish ([SRC-055](SRC-055-actual-start-is-recorded-when-a-task-is-started.md), [SRC-056](SRC-056-actual-finish-is-recorded-when-a-task-is-finished.md)). Holding only marks the task: its planned finish and load stay as they were ([DD-007](DD-007-hold-only-marks-a-task.md)).
4. Where a task is no longer wanted, they cancel it, which is possible only in the tool ([DD-017](DD-017-an-issue-closed-as-not-planned-is-reopened-tasks-a.md)).

## Success criteria

- The task's status and actual dates are updated.

## Failure modes

- A parent cannot be finished while one of its subtasks is open ([SRC-020](SRC-020-subtask-parent-child-constraint.md)).
- A blocked task cannot start before its blocker finishes ([SRC-021](SRC-021-blocked-by-blocking-constraint.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
