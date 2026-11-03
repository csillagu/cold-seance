# TC-068: A selected baseline is drawn as bars on the Gantt

Verifies [FR-050](FR-050-show-a-baseline-as-bars-on-the-gantt.md).

## Intent

Verify that the Gantt can show a selected baseline as bars.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`; task `T` in `Apollo`, planned start 2027-03-01, 3 working days.
- Baseline `v1` saved while `T` was on 2027-03-01 to 2027-03-03; then `T` moved to start on 2027-03-08.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and select baseline `v1`.

## Expected response

- `T`'s current bar runs 2027-03-08 to 2027-03-10.
- A baseline bar for `T` runs 2027-03-01 to 2027-03-03.

## Negative assertions

- Selecting the baseline changes no task's dates.

## Cleanup

Discard the test deployment.
