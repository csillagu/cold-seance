---
certainty: assumed
actor: Project member with the read-write role
---

# UC-009: Triage a task that arrived from GitHub

## Goal

Turn an issue someone opened on GitHub into planned work, or leave it unscheduled on purpose.

## Preconditions

- A third party, or someone reporting a non-plannable item such as a bug, created an issue on GitHub. It arrived in the tool automatically as an unscheduled task in its project ([SRC-061](SRC-061-new-third-party-github-issues-become-unscheduled-t.md), [SRC-115](SRC-115-new-non-plannable-github-issues-become-unscheduled.md)).
- The actor has the read-write role in that project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).

## Steps

1. The actor opens the project's Kanban or Gantt. Unscheduled tasks show there like any other task, laid at the bottom ([SRC-024](SRC-024-unscheduled-tasks-belong-to-their-project-and-appe.md)).
2. They open the unscheduled task.
3. They schedule and assign it in the project ([SRC-114](SRC-114-tasks-from-github-with-no-plan-yet-are-scheduled-a.md)): give it dates or a duration, constraints and people, as in "Plan a task in a project", "Link tasks with constraints" and "Assign people to a task".
4. Or they leave it unscheduled; it stays in the project ([SRC-024](SRC-024-unscheduled-tasks-belong-to-their-project-and-appe.md)).

## Success criteria

- The task is planned in the tool, or deliberately left unscheduled in its project.

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
