# TC-020: Scheduling leaves a fixed-date milestone on its date

Verifies [FR-012](FR-012-never-move-a-milestone-from-its-fixed-date.md).

## Intent

Verify that scheduling never moves a milestone pinned to a fixed date, even when work it depends on is pushed past that date.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: task `A`, unassigned, planned start 2027-03-01, duration 5 working days (to 2027-03-05); milestone `M`, blocked by `A`, pinned to the fixed date 2027-03-12.
- The change: set `A`'s duration to 15 working days, so it finishes 2027-03-19.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `M` back.

## Expected response

- `M` is still on 2027-03-12.

## Negative assertions

- `M` is not moved to 2027-03-22 or any other date.
- `M` is still pinned to a fixed date.

## Cleanup

Discard the test deployment.
