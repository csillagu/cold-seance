# TC-047: Eligible people who are not assigned carry no load

Verifies [FR-035](FR-035-count-only-assigned-people-toward-person-load.md).

## Intent

Verify that only a task's assigned people count toward person load.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, capacity 100%; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo`, eligibility `alice OR bob`, assigned people [`alice`], AI share 0%, planned start 2027-03-01, duration 1 working day. No other tasks.

## Procedure

1. As `alice`, create `T`.
2. Read the load of `alice` and of `bob` on 2027-03-01.

## Expected response

- `alice`'s load is 100%.
- `bob`'s load is 0%.

## Negative assertions

- `T` does not appear among `bob`'s tasks in the person load view.

## Cleanup

Discard the test deployment.
