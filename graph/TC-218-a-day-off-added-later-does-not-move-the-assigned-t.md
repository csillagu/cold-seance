# TC-218: A day off added later does not move the assigned task

Verifies [FR-148](FR-148-never-move-a-task-because-its-assigned-people-beca.md).

## Intent

Verify that, when a person adds a day off after a task is planned, leaving its assigned people unable to do it in its time, the task is not moved.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, 2027-03-01 to 2027-03-03.
- The change: `alice` adds a day off on 2027-03-02.

## Procedure

1. As `alice`, make the change.
2. Read `T`.

## Expected response

- `T` still runs 2027-03-01 to 2027-03-03.

## Negative assertions

- `T`'s assigned people are unchanged.

## Cleanup

Discard the test deployment.
