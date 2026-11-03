# TC-034: Putting a task on hold leaves its planned finish and load as they were

Verifies [FR-024](FR-024-leave-a-held-task-s-planned-finish-and-load-unchan.md).

## Intent

Verify that putting a task on hold only marks it as on hold, leaving its planned finish and its load unchanged.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 5 working days (planned finish 2027-03-05), in progress.

## Procedure

1. As `alice`, read `T`'s planned finish and `alice`'s load on each day from 2027-03-01 to 2027-03-05.
2. Set `T` to on hold through the REST API.
3. Read the same values again, and `T`'s status.

## Expected response

- `T`'s status is on hold.
- `T`'s planned finish is still 2027-03-05.
- `alice`'s load is still 100% on each day from 2027-03-01 to 2027-03-05.

## Negative assertions

- `T`'s planned start and duration are unchanged.
- No other task in `Apollo` changes.

## Cleanup

Discard the test deployment.
