# TC-216: An assignee without a calendar does not stop the others' calendars applying

Verifies [FR-146](FR-146-use-the-global-calendar-in-place-of-a-missing-assi.md).

## Intent

Verify that, when one assigned person has not filled in their own calendar, the global calendar stands in for that person only, and the other assigned people's own calendars still apply.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and a company holiday on 2027-03-04.
- Accounts `alice`, whose own calendar has a day off on 2027-03-03, and `bob`, who has never filled in their own calendar.
- Project `Apollo` created by `alice`, where `bob` has the read-only role.
- In `Apollo`: task `A`, unassigned, planned start 2027-03-01, 2 working days (to 2027-03-02); task `B`, assigned to `alice` and `bob`, blocked by `A`, 1 working day.

## Procedure

1. As `alice`, create `A` and `B`, then read `B`.

## Expected response

- `B` is on 2027-03-05.

## Negative assertions

- `B` is not on 2027-03-03 (`alice`'s day off) or 2027-03-04 (the company holiday).

## Cleanup

Discard the test deployment.
