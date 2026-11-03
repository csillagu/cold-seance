# TC-222: A system admin changes another person's capacity, absences and calendar

Verifies [FR-150](FR-150-let-a-system-admin-change-anyone-s-capacity-absenc.md).

## Intent

Verify that a system admin can change any person's capacity, absences and calendar.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, capacity 100%, with no absences and no days off.
- The changes, made by `root`: `alice`'s capacity to 60%; an absence for `alice` on 2027-03-08; a holiday in `alice`'s own calendar on 2027-03-15.

## Procedure

1. As `root`, make each change through the REST API.
2. As `alice`, read their capacity, absences and calendar.

## Expected response

- Each change is accepted: capacity 60%, absence on 2027-03-08, holiday on 2027-03-15.

## Negative assertions

- `root`'s own capacity, absences and calendar are unchanged.

## Cleanup

Discard the test deployment.
