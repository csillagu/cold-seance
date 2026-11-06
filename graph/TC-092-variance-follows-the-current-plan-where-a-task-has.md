# TC-092: Variance follows the current plan where a task has no actual dates

Verifies [FR-066](FR-066-compute-variance-against-a-selected-baseline.md).

## Intent

Verify that variance is computed per task and per milestone as the current plan minus the selected baseline, where there are no actual dates yet.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: task `T`, not started, 2027-03-01 to 2027-03-03; milestone `M` on 2027-03-10.
- Baseline `v1` saved in that state; then `T` moved to 2027-03-02 to 2027-03-04 and `M` moved to 2027-03-12.

## Procedure

1. As `alice`, open the variance of `Apollo` against `v1`.

## Expected response

- `T`'s variance is +1 day on start and +1 day on finish.
- `M`'s variance is +2 days.

## Negative assertions

- Baseline `v1` itself is unchanged.

These dates stay within one working week, so calendar days and working days give the same figure. Variance is counted in working days of the global calendar (FR-066).

## Cleanup

Discard the test deployment.
