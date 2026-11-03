# TC-027: A shared person's new work in one project leaves another project's plan unchanged

Verifies [FR-018](FR-018-never-change-a-project-s-plan-because-of-another-p.md).

## Intent

Verify that a change in one project never changes another project's plan through a shared person.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice`, `bob` and `carol`; `carol` has capacity 100%.
- Project `Apollo` created by `alice`, where `carol` has the contributor role, with task `T1` assigned to `carol`, AI share 0%, planned start 2027-03-01, duration 5 working days.
- Project `Borealis` created by `bob`, where `carol` has the contributor role.
- The change: `bob` creates task `T2` in `Borealis`, assigned to `carol`, AI share 0%, planned start 2027-03-01, duration 5 working days, so `carol` is at 200%.

## Procedure

1. As `bob`, make the change through the REST API.
2. As `alice`, read `T1` back.

## Expected response

- `T1` still runs 2027-03-01 to 2027-03-05, assigned to `carol`.

## Negative assertions

- No field of any task in `Apollo` changes.

## Cleanup

Discard the test deployment.
