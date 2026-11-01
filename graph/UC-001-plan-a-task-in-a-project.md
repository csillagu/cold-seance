---
actor: Project member with the read-write role
---

# UC-001: Plan a task in a project

## Goal

Add a task to a project's plan, with its schedule and constraints, so that it shows on the plan and on GitHub.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)), directly or through a group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

## Steps

1. The actor opens the project's Gantt or Kanban ([SRC-010](SRC-010-gantt-view.md), [SRC-009](SRC-009-kanban-view.md)) and creates a task there ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
2. They fill in its title, description, effort and AI share ([SRC-023](SRC-023-minimum-task-fields.md)).
3. They give it a planned start and finish, or a duration in whole working days ([SRC-023](SRC-023-minimum-task-fields.md), [DD-006](DD-006-durations-are-whole-working-days.md)). They may leave the dates out and plan it later: the task is then unscheduled and stays in the project ([SRC-024](SRC-024-unscheduled-tasks-belong-to-their-project-and-appe.md)).
4. They add its constraints: make it a subtask of another task ([SRC-020](SRC-020-subtask-parent-child-constraint.md)), mark it blocked by another task ([SRC-021](SRC-021-blocked-by-blocking-constraint.md)), or pin it to a fixed date as a milestone ([SRC-022](SRC-022-fixed-date-milestones-constraint.md)).
5. They set who can do it and who will do it ([SRC-029](SRC-029-two-separate-assignment-levels-who-can-and-who-wil.md)). Choosing people is described in "Assign people to a task".
6. They save the task.

## Success criteria

- The task appears on the project's Gantt and Kanban. A task blocked by another is scheduled to start the next working day after its blocker finishes ([DD-030](DD-030-dependencies-have-no-lag.md), [SRC-044](SRC-044-a-shared-working-calendar-defines-working-days-and.md)), and a parent spans its children's dates ([SRC-020](SRC-020-subtask-parent-child-constraint.md)).
- The task gets its GitHub issue, carrying its sub-issue and blocked-by relations, assignees and, for a milestone, its fixed date ([SRC-066](SRC-066-tasks-planned-in-the-tool-create-their-github-issu.md), [SRC-063](SRC-063-planning-data-is-mirrored-from-the-tool-to-github.md)).
- The change is in the audit log, with who made it, when and through which channel ([SRC-095](SRC-095-every-change-is-recorded-in-an-audit-log.md)).

## Failure modes

- A blocked-by relation that would create a cycle is rejected when the task is saved ([SRC-025](SRC-025-cycles-in-blocking-relations-are-rejected-on-write.md)).
- If the new task would push a milestone past its fixed date, the milestone is not moved; the violation shows in red on the Gantt ([SRC-022](SRC-022-fixed-date-milestones-constraint.md), [SRC-010](SRC-010-gantt-view.md)).
- If an assigned person becomes overloaded, the task is still saved; the overload shows in red ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
