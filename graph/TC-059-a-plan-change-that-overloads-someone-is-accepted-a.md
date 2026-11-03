# TC-059: A plan change that overloads someone is accepted and nothing moves

Verifies [FR-044](FR-044-never-move-tasks-to-fix-an-overload.md).

## Intent

Verify that the system accepts a plan change that overloads someone, and moves no task to remove the overload.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- Task `T1` in `Apollo`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 5 working days.
- The change: create task `T2` in `Apollo`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 5 working days.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `T1` and `T2` back.

## Expected response

- The change succeeds.
- `T1` and `T2` both run 2027-03-01 to 2027-03-05, assigned to `alice`.

## Negative assertions

- No task's dates or assigned people change to remove the overload.

## Cleanup

Discard the test deployment.
