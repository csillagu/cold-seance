# TC-014: An unassigned task takes its forbidden dates from the global calendar

Verifies [FR-009](FR-009-take-forbidden-dates-from-the-global-calendar-for.md).

## Intent

Verify that a task with no assigned people takes its forbidden dates from the global calendar, and not from the calendars of people who are only eligible for it.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and a company holiday on 2027-03-03.
- Account `alice`, whose own calendar has a day off on 2027-03-04; project `Apollo` created by `alice`.
- In `Apollo`:
  - task `A`, unassigned: planned start 2027-03-01, duration 2 working days, so it finishes 2027-03-02;
  - task `B`, eligibility `alice`, no assigned people, blocked by `A`, duration 1 working day.

## Procedure

1. As `alice`, create `A` and then `B` through the REST API.
2. Read `B` back.

## Expected response

- `B` is scheduled on 2027-03-04.

## Negative assertions

- `B` is not scheduled on 2027-03-03 (company holiday).
- `alice`'s day off on 2027-03-04 does not push `B` later, because `alice` is not assigned.

## Cleanup

Discard the test deployment.
