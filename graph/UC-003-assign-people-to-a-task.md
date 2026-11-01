---
certainty: assumed
actor: Project member with the read-write role
---

# UC-003: Assign people to a task

## Goal

Decide who can do a task and who will do it, without overloading anyone.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The people to choose from are in the global pool and have at least read access to the project ([SRC-046](SRC-046-people-live-in-one-global-pool.md), [DD-013](DD-013-shared-people-can-be-made-eligible-or-assigned-onl.md)).

## Steps

1. The actor opens the task.
2. They set its eligibility: who can do it, as an AND/OR expression over people up to two levels deep, such as `A AND (B OR C OR D)` ([SRC-029](SRC-029-two-separate-assignment-levels-who-can-and-who-wil.md), [SRC-030](SRC-030-eligibility-is-an-and-or-expression-over-people-up.md)).
3. While nobody is assigned yet, the person load view shows the task in red if every valid combination of eligible people overloads someone, in amber if only some do, and in green if at least one fits ([SRC-035](SRC-035-red-amber-and-green-load-for-eligible-but-unassign.md), [SRC-011](SRC-011-person-load-view.md)).
4. They assign a concrete list of people: who will do it ([SRC-032](SRC-032-assignment-is-a-concrete-list-of-people.md)). They may assign someone outside the eligibility expression ([DD-031](DD-031-assignment-may-include-people-outside-the-eligibil.md)).
5. Where needed, they override the task's person-load percentage for one assignment, for example 30% on a long task ([DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)).
6. They save.

## Success criteria

- The assigned people carry the task's load for its whole duration, adjusted for its AI share ([SRC-034](SRC-034-only-assigned-people-count-toward-person-load.md), [DD-009](DD-009-person-load-is-a-percentage-applied-over-the-task.md), [SRC-038](SRC-038-person-load-by-task-type-and-ai-share.md)), and their load is visible in the person load view.

## Failure modes

- A person without read access to the project cannot be made eligible or assigned ([DD-013](DD-013-shared-people-can-be-made-eligible-or-assigned-onl.md)).
- If the assigned people cannot do the task in its time, for example because one of them has a day off during it, the task is not moved; it turns red ([SRC-122](SRC-122-a-task-turns-red-when-its-assigned-people-cannot-d.md), [SRC-124](SRC-124-forbidden-dates-come-from-the-assignees-calendars.md), [SRC-127](SRC-127-a-change-in-availability-turns-a-task-red-without-m.md)).
- If the assignment overloads someone on some day, it is still saved; the overload shows in red to every project involved, and nothing is moved automatically ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md), [SRC-047](SRC-047-an-overload-is-shown-in-red-to-every-project-invol.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
