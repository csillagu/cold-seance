# TC-008: A blocked task follows its blocker when the blocker moves later

Verifies [FR-005](FR-005-reschedule-blocked-tasks-within-a-project-when-the.md).

## Intent

Verify that, within a project, a blocked task is rescheduled to start on its next working day after the blocker finishes when the blocker is moved later, with no lag.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned:
  - task `A`: planned start 2027-03-01 (Monday), duration 3 working days, so it finishes 2027-03-03;
  - task `B`: blocked by `A`, duration 2 working days, so it is scheduled 2027-03-04 to 2027-03-05.
- The change: set `A`'s planned start to 2027-03-03.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `A` and `B` back.

## Expected response

- `A` runs 2027-03-03 to 2027-03-05 (Friday).
- `B` runs 2027-03-08 (Monday, the next working day after 2027-03-05) to 2027-03-09.

## Negative assertions

- `B` does not start on 2027-03-06 or 2027-03-07 (weekend), and not later than 2027-03-08.
- `B`'s duration is still 2 working days.

## Cleanup

Discard the test deployment.
