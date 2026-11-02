---
certainty: verified
actor: Project member with the read-write role
---

# UC-021: Link tasks with constraints

## Goal

Record how tasks depend on each other, so that the schedule follows from it.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The tasks to link exist in the project.

## Steps

1. The actor opens a task on the project's Gantt or Kanban ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
2. They make it a subtask of another task ([SRC-020](SRC-020-subtask-parent-child-constraint.md)), or mark it blocked by another task ([SRC-021](SRC-021-blocked-by-blocking-constraint.md)).
3. They save.

## Success criteria

- A task blocked by another is scheduled to start the next working day after its blocker finishes ([DD-030](DD-030-dependencies-have-no-lag.md), [SRC-121](SRC-121-scheduling-skips-non-working-days.md)).
- A parent spans its children's dates ([SRC-020](SRC-020-subtask-parent-child-constraint.md)).

## Failure modes

- A blocked-by relation that would create a cycle is rejected when it is saved ([SRC-025](SRC-025-cycles-in-blocking-relations-are-rejected-on-write.md)).
- If the new constraint would push a milestone past its fixed date, the milestone is not moved; the violation shows in red on the Gantt ([SRC-022](SRC-022-fixed-date-milestones-constraint.md), [SRC-010](SRC-010-gantt-view.md)).
- Depending on another project's milestone is described in "Depend on another project's milestone".

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item.
