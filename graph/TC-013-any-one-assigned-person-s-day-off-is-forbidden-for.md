# TC-013: Any one assigned person's day off is forbidden for the task

Verifies [FR-008](FR-008-treat-each-assigned-person-s-days-off-as-forbidden.md).

## Intent

Verify that a day off in the calendar of only one of a task's several assigned people is a forbidden date for the whole task.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` (own calendar: no days off) and `bob` (own calendar: day off on 2027-03-03, Wednesday).
- Project `Apollo` created by `alice`; `bob` has the read-write role in it.
- In `Apollo`:
  - task `A`, unassigned: planned start 2027-03-01, duration 2 working days, so it finishes 2027-03-02;
  - task `B`, assigned to `alice` and `bob`, blocked by `A`, duration 1 working day.

## Procedure

1. As `alice`, create `A` and then `B` through the REST API.
2. Read `B` back.

## Expected response

- `B` is scheduled on 2027-03-04.

## Negative assertions

- `B` is not scheduled on 2027-03-03, even though `alice` is free that day.

## Cleanup

Discard the test deployment.
