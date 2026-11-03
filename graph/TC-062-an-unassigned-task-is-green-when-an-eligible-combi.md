# TC-062: An unassigned task is green when an eligible combination fits

Verifies [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md).

## Intent

Verify that a task with an eligibility expression but no assigned people is shown in green in the person load view when a valid combination of eligible people fits.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, capacity 100%, with no tasks; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `U` in `Apollo`, eligibility `alice OR bob`, no assigned people, AI share 0%, planned start 2027-03-01, duration 5 working days. No combination overloads anyone.

## Procedure

1. As `alice`, open the person load view of `Apollo` for 2027-03-01 to 2027-03-05.

## Expected response

- `U` is shown in green.

## Negative assertions

- `U` is not shown in red or amber.

## Cleanup

Discard the test deployment.
