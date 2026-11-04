# TC-270: A floating milestone is done when its blockers are done

Verifies [FR-196](FR-196-mark-a-floating-milestone-done-when-what-it-is-blo.md).

## Intent

Verify that a floating milestone is marked done once every task it is blocked by is done, and not before.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned, unscheduled tasks `A` and `B`, both not started; floating milestone `Ready`, blocked by `A` and `B`.

## Procedure

1. As `alice`, mark `A` done through the REST API, then read `Ready`.
2. As `alice`, mark `B` done through the REST API, then read `Ready`.

## Expected response

- After step 1, `Ready` is not done.
- After step 2, `Ready` is done, without anyone setting its status.

## Negative assertions

- `Ready` is not done while `B` is not done.

## Cleanup

Discard the test deployment.
