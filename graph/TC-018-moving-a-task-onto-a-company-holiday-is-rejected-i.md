# TC-018: Moving a task onto a company holiday is rejected in the UI

Verifies [FR-011](FR-011-block-moving-a-task-to-a-forbidden-date.md).

## Intent

Verify that a change made in the UI that moves a task onto one of its forbidden dates is rejected.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and a company holiday on 2027-03-10.
- Account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, unassigned, planned start 2027-03-01, duration 1 working day.

## Procedure

1. As `alice`, open the Gantt of `Apollo` in the browser and move `T` to start on 2027-03-10.
2. Reload the Gantt, and read `T` through the REST API.

## Expected response

- The UI reports that the move was rejected.
- After the reload `T` is still on 2027-03-01, and the REST API returns planned start 2027-03-01.

## Negative assertions

- `T` is not stored on 2027-03-10 or on any other new date.

## Cleanup

Discard the test deployment.
