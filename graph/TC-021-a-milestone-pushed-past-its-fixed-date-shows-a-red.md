# TC-021: A milestone pushed past its fixed date shows a red violation on the Gantt

Verifies [FR-013](FR-013-show-a-red-violation-when-a-fixed-date-milestone-i.md).

## Intent

Verify that the Gantt marks in red a fixed-date milestone that work it depends on would push past its date.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: task `A`, unassigned, planned start 2027-03-01, duration 5 working days (to 2027-03-05); milestone `M`, blocked by `A`, pinned to the fixed date 2027-03-12.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and note how `M` is shown.
2. Set `A`'s duration to 15 working days (finishing 2027-03-19).
3. Reload the Gantt.

## Expected response

- At step 1, `M` shows no red violation.
- At step 3, the violation on `M` (or on its dependency on `A`) is shown in red.

## Negative assertions

- `M` is still drawn on 2027-03-12.

## Cleanup

Discard the test deployment.
