---
actor: System admin
---

# UC-028: Maintain the company holiday calendar

## Goal

Keep company holidays in the tool, so that no task is planned on them.

## Preconditions

- The actor is a system admin, who manages company holidays ([SRC-128](SRC-128-company-holidays-are-managed-by-the-system-admins.md)).

## Steps

1. The actor opens the global calendar ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)).
2. They enter the company holidays ([SRC-128](SRC-128-company-holidays-are-managed-by-the-system-admins.md)).

## Success criteria

- A company holiday is a forbidden date for every task, like a weekend ([SRC-126](SRC-126-company-holidays-are-forbidden-for-every-task.md)): scheduling skips it ([SRC-121](SRC-121-scheduling-skips-non-working-days.md)), and no task can be moved onto it ([SRC-123](SRC-123-moving-a-task-to-a-forbidden-date-is-blocked.md)).

## Failure modes

- A task already planned over a new company holiday is not moved; it turns red ([SRC-127](SRC-127-a-change-in-availability-turns-a-task-red-without-m.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
