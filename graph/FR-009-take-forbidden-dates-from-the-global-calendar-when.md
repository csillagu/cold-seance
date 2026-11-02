---
certainty: assumed
---

# FR-009: Take forbidden dates from the global calendar when assignee calendars are missing

When a task has no assigned people, the system must take its forbidden dates from the global calendar ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)). When an assigned person has not filled in their own calendar, the system must use the global calendar in place of that person's calendar only, and still apply the other assigned people's own calendars ([SRC-163](SRC-163-for-an-assignee-without-a-calendar-the-global-cale.md), [SRC-124](SRC-124-forbidden-dates-come-from-the-assignees-calendars.md)). The global calendar holds company holidays and weekends ([SRC-131](SRC-131-the-global-calendar-holds-company-holidays-and-week.md)).

It serves [UC-002](UC-002-reschedule-work-in-a-project.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
