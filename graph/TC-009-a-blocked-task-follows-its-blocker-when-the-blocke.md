# TC-009: A blocked task follows its blocker when the blocker moves earlier

Verifies [FR-005](FR-005-reschedule-blocked-tasks-within-a-project-when-the.md).

## Intent

Verify that, within a project, a blocked task is rescheduled to start on its next working day after the blocker finishes when the blocker is moved earlier.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned:
  - task `A`: planned start 2027-03-03, duration 3 working days, so it finishes 2027-03-05;
  - task `B`: blocked by `A`, duration 2 working days, so it is scheduled 2027-03-08 to 2027-03-09.
- The change: set `A`'s planned start to 2027-03-01.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `A` and `B` back.

## Expected response

- `A` runs 2027-03-01 to 2027-03-03.
- `B` runs 2027-03-04 to 2027-03-05.

## Negative assertions

- `B` does not keep its old start of 2027-03-08.

## Cleanup

Discard the test deployment.
