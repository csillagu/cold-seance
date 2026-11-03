# TC-213: A task's planned finish is its start plus its duration in working days

Verifies [FR-144](FR-144-derive-a-task-s-planned-finish-from-its-start-and.md).

## Intent

Verify that the system derives a task's planned finish from its planned start and duration, counted over the task's working days.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and a company holiday on 2027-03-08.
- Account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, unassigned, planned start 2027-03-04 (Thursday), duration 4 working days, with no planned finish given.

## Procedure

1. As `alice`, create `T`.
2. Read `T`'s planned finish.

## Expected response

- The planned finish is 2027-03-10 (working days: 03-04, 03-05, 03-09, 03-10).

## Negative assertions

- The planned finish is not 2027-03-07 (calendar days) or 2027-03-09 (holiday counted).

## Cleanup

Discard the test deployment.
