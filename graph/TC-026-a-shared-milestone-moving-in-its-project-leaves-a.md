# TC-026: A shared milestone moving in its project leaves a dependent project's plan unchanged

Verifies [FR-018](FR-018-never-change-a-project-s-plan-because-of-another-p.md).

## Intent

Verify that a change in one project never changes another project's plan through a shared milestone.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has the read-only role, with milestone `M` on 2027-03-10.
- Project `Apollo` created by `alice`, with task `T`, unassigned, blocked by `M`, planned start 2027-03-11, duration 2 working days.
- The change: `bob` moves `M` to 2027-03-17.

## Procedure

1. As `bob`, make the change through the REST API.
2. As `alice`, read `T` back.

## Expected response

- `T` still runs 2027-03-11 to 2027-03-12.

## Negative assertions

- No field of any task in `Apollo` changes.
- The audit log of `Apollo` records no change caused by the move.

## Cleanup

Discard the test deployment.
