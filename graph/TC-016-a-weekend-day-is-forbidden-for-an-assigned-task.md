# TC-016: A weekend day is forbidden for an assigned task

Verifies [FR-010](FR-010-treat-company-holidays-and-weekends-as-forbidden-d.md).

## Intent

Verify that the global calendar's weekend days are forbidden dates for a task whatever its assigned person's own calendar says.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, whose own calendar has no days off; project `Apollo` created by `alice`.
- In `Apollo`:
  - task `A`, unassigned: planned start 2027-03-03, duration 3 working days, so it finishes 2027-03-05 (Friday);
  - task `B`, assigned to `alice`, blocked by `A`, duration 1 working day.

## Procedure

1. As `alice`, create `A` and then `B` through the REST API.
2. Read `B` back.

## Expected response

- `B` is scheduled on 2027-03-08 (Monday).

## Negative assertions

- `B` is not scheduled on 2027-03-06 or 2027-03-07.

## Cleanup

Discard the test deployment.
