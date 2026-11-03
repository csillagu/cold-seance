# TC-029: A task turns red when an assigned person is overloaded during it

Verifies [FR-020](FR-020-turn-a-task-red-when-its-assigned-people-cannot-do.md).

## Intent

Verify that a task is shown in red when one of its assigned people is overloaded on a day within it.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- In `Apollo`: task `T1`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 3 working days; task `T2`, assigned to `alice`, AI share 0%, unscheduled.
- The change: give `T2` planned start 2027-03-03 and duration 1 working day, so `alice` is at 200% on 2027-03-03.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and note how `T1` is shown.
2. Make the change.
3. Reload the Gantt.

## Expected response

- At step 1, `T1` is not red.
- At step 3, `T1` and `T2` are both shown in red.

## Negative assertions

- Neither task's dates change.

## Cleanup

Discard the test deployment.
