---
certainty: assumed
---

# FR-009: Take forbidden dates from the global calendar when assignee calendars are missing

When a task has no assigned people, or an assigned person has not filled in their own calendar, the system must take the task's forbidden dates from the global calendar instead ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)). The global calendar holds company holidays and weekends ([SRC-131](SRC-131-the-global-calendar-holds-company-holidays-and-week.md)).

Not stated: for a task with several assigned people where only some have filled in their calendar, whether the global calendar replaces only the missing person's days off or the whole task's.

It serves [UC-002](UC-002-reschedule-work-in-a-project.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
