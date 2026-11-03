# TC-046: A task's load applies on every day of its duration and no other

Verifies [FR-034](FR-034-apply-a-task-s-load-to-each-assigned-person-over-i.md).

## Intent

Verify that a task's person-load percentage applies to each assigned person on every day of the task's duration.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, AI share 40% (person load 60%), planned start 2027-03-01, duration 5 working days. No other tasks.

## Procedure

1. As `alice`, create `T`.
2. Read `alice`'s load on each day from 2027-02-26 to 2027-03-08.

## Expected response

- `alice`'s load is 60% on each of 2027-03-01, 2027-03-02, 2027-03-03, 2027-03-04 and 2027-03-05.

## Negative assertions

- `alice`'s load is 0% on 2027-02-26 and on 2027-03-08.
- The load is not spread or reduced across the duration (no day shows 12% or any other value).

## Cleanup

Discard the test deployment.
