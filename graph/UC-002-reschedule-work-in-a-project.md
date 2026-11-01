---
actor: Project member with the read-write role
---

# UC-002: Reschedule work in a project

## Goal

Change when a piece of work happens and see the knock-on effect on the rest of the plan.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The task already has planned dates.

## Steps

1. The actor opens the project's Gantt ([SRC-010](SRC-010-gantt-view.md)).
2. They move a task, or change its duration ([SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
3. Tasks blocked by it, and its parent, are rescheduled automatically within the project ([SRC-003](SRC-003-constraints-reschedule-dates-automatically-within.md), [SRC-021](SRC-021-blocked-by-blocking-constraint.md), [SRC-020](SRC-020-subtask-parent-child-constraint.md)), skipping non-working days ([SRC-121](SRC-121-scheduling-skips-non-working-days.md), [SRC-124](SRC-124-forbidden-dates-come-from-the-assignees-calendars.md), [SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)).
4. The actor reviews the new schedule and any red flags it raised.

## Success criteria

- Every dependent task in the project has moved so that no constraint is broken.

## Failure modes

- Moving a task to a forbidden date is blocked: a day off in an assigned person's calendar or, for a task nobody is assigned to, a company holiday ([SRC-123](SRC-123-moving-a-task-to-a-forbidden-date-is-blocked.md), [SRC-124](SRC-124-forbidden-dates-come-from-the-assignees-calendars.md), [SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)).
- A change that would push a milestone past its fixed date leaves the milestone where it is and shows the violation in red ([SRC-022](SRC-022-fixed-date-milestones-constraint.md)).
- If the moved task is a shared milestone that now lands after a dependent task's start in another project, that other project's dates do not move; the dependency turns red there and both owners are notified ([SRC-004](SRC-004-cross-project-effects-never-change-another-project.md), [SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md), [SRC-050](SRC-050-both-owners-get-an-in-app-notification.md)).
- If the move overloads someone, nothing else is moved to fix it; the overload shows in red ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
