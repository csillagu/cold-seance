# TC-061: An unassigned task is amber when only some eligible combinations overload someone

Verifies [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md).

## Intent

Verify that a task with an eligibility expression but no assigned people is shown in amber in the person load view when some valid combinations of eligible people overload someone and others don't.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, capacity 100%; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `X` in `Apollo`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 5 working days. `bob` has no tasks.
- Task `U` in `Apollo`, eligibility `alice OR bob`, no assigned people, AI share 0%, planned start 2027-03-01, duration 5 working days. A combination with `alice` overloads `alice`; `bob` alone fits.

## Procedure

1. As `alice`, open the person load view of `Apollo` for 2027-03-01 to 2027-03-05.

## Expected response

- `U` is shown in amber.

## Negative assertions

- `U` is not shown in red.

Not stated: FR-045's green condition ("at least one valid combination fits") also holds here. This test expects amber, the colour FR-045 names for "some do and others don't"; if green is meant to take precedence, the expected colour changes.

## Cleanup

Discard the test deployment.
