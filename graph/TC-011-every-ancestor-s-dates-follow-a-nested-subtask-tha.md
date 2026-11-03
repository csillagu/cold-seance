# TC-011: Every ancestor's dates follow a nested subtask that moves

Verifies [FR-006](FR-006-make-a-parent-task-span-its-children-s-dates.md).

## Intent

Verify that a change to a subtask's dates updates the dates of every ancestor, at every level of nesting.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned: task `P`, its subtask `C`, and `C`'s subtask `G` (planned start 2027-03-01, 2 working days, to 2027-03-02). `G` is `C`'s only subtask and `C` is `P`'s only subtask.
- The change: set `G`'s planned start to 2027-03-08.

## Procedure

1. Make the change as `alice` through the REST API.
2. Read `C` and `P` back.

## Expected response

- `C` spans 2027-03-08 to 2027-03-09.
- `P` spans 2027-03-08 to 2027-03-09.

## Negative assertions

- Neither `C` nor `P` keeps any date from before the change.

## Cleanup

Discard the test deployment.
