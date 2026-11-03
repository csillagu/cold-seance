# TC-045: One assignment's load override replaces the task default for that person only

Verifies [FR-033](FR-033-let-a-single-assignment-override-the-task-s-person.md).

## Intent

Verify that the person-load percentage can be overridden for one assignment, replacing the task's default for that person only.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo`, AI share 0% (default 100%), assigned to `alice` and `bob`, planned start 2027-03-01, duration 10 working days.
- The change: override `alice`'s assignment on `T` to 30%.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read the load of `alice` and of `bob` on 2027-03-01.

## Expected response

- `alice`'s load on 2027-03-01 is 30%.
- `bob`'s load on 2027-03-01 is 100%.

## Negative assertions

- `T`'s own person-load percentage is still 100%.
- `T`'s AI share is still 0%.

## Cleanup

Discard the test deployment.
