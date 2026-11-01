---
certainty: assumed
actor: Project member with the read-write role
---

# UC-001: Plan a task in a project

## Goal

Add a task to a project's plan.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)), directly or through a group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

## Steps

1. The actor opens the project's Gantt or Kanban ([SRC-010](SRC-010-gantt-view.md), [SRC-009](SRC-009-kanban-view.md)) and creates a task there ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
2. They fill in its title, description, effort and AI share ([SRC-023](SRC-023-minimum-task-fields.md)).
3. They give it a planned start and finish, or a duration in whole working days ([SRC-023](SRC-023-minimum-task-fields.md), [DD-006](DD-006-durations-are-whole-working-days.md)). They may leave the dates out and plan it later: the task is then unscheduled and stays in the project ([SRC-024](SRC-024-unscheduled-tasks-belong-to-their-project-and-appe.md)).
4. They save the task.

Linking it to other tasks is described in "Link tasks with constraints", and choosing people in "Assign people to a task".

## Success criteria

- The task appears on the project's Gantt and Kanban; an unscheduled one lies at the bottom ([SRC-024](SRC-024-unscheduled-tasks-belong-to-their-project-and-appe.md)).

## Failure modes

- A member with only the read-only role cannot create tasks ([SRC-091](SRC-091-read-only-role.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
