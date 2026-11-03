# TC-012: Scheduling skips an assigned person's day off

Verifies [FR-007](FR-007-skip-a-task-s-non-working-days-when-scheduling-it.md).

## Intent

Verify that, when the system schedules a task, it skips the task's forbidden dates rather than placing work on them.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, whose own calendar has a day off on 2027-03-09 (Tuesday); project `Apollo` created by `alice`.
- In `Apollo`:
  - task `A`, unassigned: planned start 2027-03-04, duration 3 working days, so it finishes 2027-03-08 (Monday);
  - task `B`, assigned to `alice`, blocked by `A`, duration 2 working days.

## Procedure

1. As `alice`, create `A` and then `B` through the REST API.
2. Read `B` back.

## Expected response

- `B` runs 2027-03-10 to 2027-03-11.

## Negative assertions

- `B` does not start on 2027-03-09.
- `B` carries no working day on 2027-03-06, 2027-03-07 or 2027-03-09.

## Cleanup

Discard the test deployment.
