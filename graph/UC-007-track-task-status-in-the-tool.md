---
certainty: assumed
actor: Project member with the read-write role
---

# UC-007: Track task status in the tool

## Goal

Move a task through its statuses as work progresses.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).

## Steps

1. The actor opens a Kanban, whose columns follow task status ([SRC-009](SRC-009-kanban-view.md)).
2. They move a task's card to start it, put it on hold or finish it ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).

## Success criteria

- The card shows in the column of its new status ([SRC-009](SRC-009-kanban-view.md)).
- Starting records the task's actual start; finishing records its actual finish ([SRC-055](SRC-055-actual-start-is-recorded-when-a-task-is-started.md), [SRC-056](SRC-056-actual-finish-is-recorded-when-a-task-is-finished.md)).
- Holding only marks the task: its planned finish and its load stay as they were ([DD-007](DD-007-hold-only-marks-a-task.md)).

## Failure modes

- A parent cannot be finished while one of its subtasks is open ([SRC-020](SRC-020-subtask-parent-child-constraint.md)).
- A blocked task cannot start before its blocker finishes ([SRC-021](SRC-021-blocked-by-blocking-constraint.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
