# TC-015: A company holiday is forbidden for an assigned task

Verifies [FR-010](FR-010-treat-company-holidays-and-weekends-as-forbidden-d.md).

## Intent

Verify that a company holiday is a forbidden date for a task even when the calendars of its assigned people do not list it.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and a company holiday on 2027-03-03.
- Account `alice`, whose own calendar has no days off; project `Apollo` created by `alice`.
- In `Apollo`:
  - task `A`, unassigned: planned start 2027-03-01, duration 2 working days, so it finishes 2027-03-02;
  - task `B`, assigned to `alice`, blocked by `A`, duration 1 working day.

## Procedure

1. As `alice`, create `A` and then `B` through the REST API.
2. Read `B` back.

## Expected response

- `B` is scheduled on 2027-03-04.

## Negative assertions

- `B` is not scheduled on 2027-03-03.

## Cleanup

Discard the test deployment.
