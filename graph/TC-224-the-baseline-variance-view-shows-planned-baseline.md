# TC-224: The baseline variance view shows planned, baseline and actual dates side by side

Verifies [FR-152](FR-152-compare-planned-baseline-and-actual-dates-in-the-b.md).

## Intent

Verify that the baseline variance view shows each task's planned, baseline and actual dates side by side.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- `D`: the date on which the test runs.
- Account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, no blockers, planned start 2027-03-01, 3 working days. Baseline `v1` saved; then `T` moved to start 2027-03-08 and set to in progress on `D`.

## Procedure

1. As `alice`, open the baseline variance view of `Apollo` with `v1` selected.

## Expected response

- `T`'s row shows its planned dates (2027-03-08 to 2027-03-10), its baseline dates (2027-03-01 to 2027-03-03) and its actual start `D`, side by side.

## Negative assertions

- No actual finish is shown for `T`.

## Cleanup

Discard the test deployment.
