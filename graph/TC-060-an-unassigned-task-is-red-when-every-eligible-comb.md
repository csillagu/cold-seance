# TC-060: An unassigned task is red when every eligible combination overloads someone

Verifies [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md).

## Intent

Verify that a task with an eligibility expression but no assigned people is shown in red in the person load view when every valid combination of eligible people overloads someone.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, capacity 100%; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Tasks `X` (assigned to `alice`) and `Y` (assigned to `bob`) in `Apollo`, AI share 0%, planned start 2027-03-01, duration 5 working days.
- Task `U` in `Apollo`, eligibility `alice OR bob`, no assigned people, AI share 0%, planned start 2027-03-01, duration 5 working days.

## Procedure

1. As `alice`, open the person load view of `Apollo` for 2027-03-01 to 2027-03-05.

## Expected response

- `U` is shown in red.

## Negative assertions

- `U` is not shown in amber or green.
- `U` still has no assigned people.

## Cleanup

Discard the test deployment.
