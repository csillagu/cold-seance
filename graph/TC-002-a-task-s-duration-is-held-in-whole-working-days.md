# TC-002: A task's duration is held in whole working days

Verifies [FR-002](FR-002-take-task-durations-in-whole-working-days.md).

## Intent

Verify that the system takes a task's duration as a whole number of working days, not calendar days or a sub-day unit.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- Task `Draft schema` in `Apollo`, unassigned, planned start 2027-03-04 (a Thursday), duration 3.
- A second attempt to set the duration of `Draft schema` to 2.5.

## Procedure

1. As `alice`, create `Draft schema` through the REST API with the inputs above.
2. Read it back.
3. As `alice`, try to set its duration to 2.5, then read it back.

## Expected response

- After step 2 the duration reads back as 3 working days, and the planned finish is 2027-03-08: three working days (Thursday, Friday, Monday), not three calendar days.

## Negative assertions

- After step 3 the stored duration is not 2.5. Not stated: whether a fractional duration is rejected or rounded; this test asserts only that no fractional duration is stored.
- The tool offers no unit for the duration other than working days.

## Cleanup

Discard the test deployment.
