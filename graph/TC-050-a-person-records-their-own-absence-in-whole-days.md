# TC-050: A person records their own absence in whole days

Verifies [FR-038](FR-038-let-each-person-record-their-own-absences-in-whole.md).

## Intent

Verify that a person can record their own absence, in whole days.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- The absence: vacation from 2027-03-08 to 2027-03-12, entered by `alice`.

## Procedure

1. As `alice`, record the absence through the REST API.
2. Read `alice`'s absences back.

## Expected response

- The absence is stored, covering exactly the whole days 2027-03-08 to 2027-03-12.

## Negative assertions

- The tool offers no part-day unit (hours, half days) for an absence.
- No other person's absences change.

## Cleanup

Discard the test deployment.
