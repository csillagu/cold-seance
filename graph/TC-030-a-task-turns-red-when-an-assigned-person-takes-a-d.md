# TC-030: A task turns red when an assigned person takes a day off during it

Verifies [FR-020](FR-020-turn-a-task-red-when-its-assigned-people-cannot-do.md).

## Intent

Verify that a task is shown in red when one of its assigned people is on holiday on a day within it.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, whose own calendar has no days off; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, planned start 2027-03-01, duration 3 working days.
- The change: `alice` adds a day off on 2027-03-02 to her own calendar.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and note how `T` is shown.
2. Make the change.
3. Reload the Gantt.

## Expected response

- At step 1, `T` is not red.
- At step 3, `T` is shown in red.

## Negative assertions

- `T` still runs 2027-03-01 to 2027-03-03.

## Cleanup

Discard the test deployment.
