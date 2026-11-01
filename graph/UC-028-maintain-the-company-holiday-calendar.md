# UC-028: Maintain the company holiday calendar

## Goal

Keep company holidays in the tool, so that tasks nobody is assigned to yet are not planned on them.

The actor is not stated in the input: who maintains the global calendar is still open.

## Steps

1. The actor opens the global calendar ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)).
2. They enter the company holidays ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)).

## Success criteria

- Company holidays are forbidden dates for every task with no assigned people ([SRC-125](SRC-125-a-task-with-no-assignees-takes-its-forbidden-dates.md)): scheduling skips them ([SRC-121](SRC-121-scheduling-skips-non-working-days.md)), and such a task cannot be moved onto one ([SRC-123](SRC-123-moving-a-task-to-a-forbidden-date-is-blocked.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
