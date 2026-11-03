# TC-044: Two 50% AI tasks on the same days fit one full-time person

Verifies [FR-032](FR-032-derive-a-task-s-default-person-load-percentage-fro.md).

## Intent

Verify that two tasks with a 50% AI share can be done by one full-time person at the same time.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- Tasks `T1` and `T2` in `Apollo`, each assigned to `alice`, AI share 50%, planned start 2027-03-01, duration 5 working days.

## Procedure

1. As `alice`, create both tasks.
2. Read `alice`'s load on each day from 2027-03-01 to 2027-03-05, and open the person load view for that week.

## Expected response

- `alice`'s load is 100% on each of those days.

## Negative assertions

- `alice` is not marked as overloaded on any of those days.
- Neither task is red.

## Cleanup

Discard the test deployment.
