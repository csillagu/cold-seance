---
certainty: assumed
actor: Any user, for their own calendar
---

# UC-020: Maintain my own working calendar

## Goal

Keep one's own working days and holidays right, so that scheduling skips the days one does not work.

## Steps

1. The actor opens their own calendar ([SRC-120](SRC-120-each-person-maintains-their-own-working-calendar.md)).
2. They set which days they work and enter their holidays ([SRC-120](SRC-120-each-person-maintains-their-own-working-calendar.md)).

## Success criteria

- The actor's days off are forbidden dates for the tasks they are assigned to ([SRC-124](SRC-124-forbidden-dates-come-from-the-assignees-calendars.md)): scheduling skips them ([SRC-121](SRC-121-scheduling-skips-non-working-days.md)), and those tasks cannot be moved onto them ([SRC-123](SRC-123-moving-a-task-to-a-forbidden-date-is-blocked.md)).

## Failure modes

- If a day off the actor adds falls inside a task they are assigned to, the task is not moved; it turns red ([SRC-122](SRC-122-a-task-turns-red-when-its-assigned-people-cannot-d.md), [SRC-127](SRC-127-a-change-in-availability-turns-a-task-red-without-m.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
