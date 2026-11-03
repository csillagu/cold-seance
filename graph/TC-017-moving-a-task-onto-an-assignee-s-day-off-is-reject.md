# TC-017: Moving a task onto an assignee's day off is rejected through the REST API

Verifies [FR-011](FR-011-block-moving-a-task-to-a-forbidden-date.md).

## Intent

Verify that a change made through the REST API that moves a task onto one of its forbidden dates is rejected.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, whose own calendar has a day off on 2027-03-10; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, planned start 2027-03-01, duration 1 working day.
- The change: set `T`'s planned start to 2027-03-10.

## Procedure

1. As `alice`, send the change through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports that the change was rejected.
- `T` still starts on 2027-03-01.

## Negative assertions

- `T` is not moved to any other date in place of 2027-03-10.
- No audit log entry records a change to `T`'s dates.

## Cleanup

Discard the test deployment.
