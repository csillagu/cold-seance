# TC-194: The weekend days set in the global calendar drive scheduling

Verifies [FR-131](FR-131-let-the-weekend-days-be-set-in-the-global-calendar.md).

## Intent

Verify that the system takes which days are the weekend from the global calendar, as a system admin sets them.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with no company holidays.
- `root` sets the global calendar's weekend to Friday and Saturday.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned: task `A`, planned start 2027-03-03 (Wednesday), 2 working days; task `B`, blocked by `A`, 1 working day.

## Procedure

1. As `root`, set the weekend.
2. As `alice`, create `A` and `B`, then read them.

## Expected response

- `A` runs 2027-03-03 to 2027-03-04.
- `B` is on 2027-03-07 (Sunday).

## Negative assertions

- No work of `A` or `B` falls on 2027-03-05 or 2027-03-06 (Friday, Saturday).

## Cleanup

Discard the test deployment.
