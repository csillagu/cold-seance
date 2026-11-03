# TC-093: Variance uses a task's actual start where it has one

Verifies [FR-066](FR-066-compute-variance-against-a-selected-baseline.md).

## Intent

Verify that variance uses a task's actual dates, in place of the current plan, where they exist.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- `D`: the date on which the test runs, a Monday to Thursday that is not a company holiday; `D+1`: the next calendar day.
- Account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, not started, no blockers, planned start `D+1`, 1 working day. Baseline `v1` saved in that state.

## Procedure

1. As `alice`, set `T` to in progress on `D`, so its actual start is `D`.
2. Open the variance of `Apollo` against `v1`.

## Expected response

- `T`'s start variance is −1 day (actual start `D` minus baseline start `D+1`).

## Negative assertions

- The variance is not computed from the planned start: it is not 0.

## Cleanup

Discard the test deployment.
