# TC-010: A parent task's dates follow a subtask that moves

Verifies [FR-006](FR-006-make-a-parent-task-span-its-children-s-dates.md).

## Intent

Verify that a parent task's dates keep spanning its subtasks' dates and update automatically when a subtask moves.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned: parent task `P` with subtasks `C1` (2027-03-01, 3 working days, to 2027-03-03) and `C2` (2027-03-08, 3 working days, to 2027-03-10). `P` therefore spans 2027-03-01 to 2027-03-10.
- The change: set `C2`'s planned start to 2027-03-15.

## Procedure

1. As `alice`, read `P` and confirm it spans 2027-03-01 to 2027-03-10.
2. Make the change through the REST API.
3. Read `P` back.

## Expected response

- `P` spans 2027-03-01 to 2027-03-17 (the finish of `C2`, now 2027-03-15 plus 3 working days).

## Negative assertions

- `C1` is unchanged.
- `P`'s start does not move.

## Cleanup

Discard the test deployment.
