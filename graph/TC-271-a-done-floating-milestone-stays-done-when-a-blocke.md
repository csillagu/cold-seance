# TC-271: A done floating milestone stays done when a blocker is reopened

Verifies [FR-196](FR-196-mark-a-floating-milestone-done-when-what-it-is-blo.md).

## Intent

Verify that a floating milestone that is done stays done when one of the tasks it is blocked by is reopened.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned, unscheduled tasks `A` and `B`, both done; floating milestone `Ready`, blocked by `A` and `B`, done.

## Procedure

1. As `alice`, set `A` back to in progress through the REST API.
2. Read `Ready` as `alice`.

## Expected response

- Reopening `A` succeeds.
- `Ready` is still done.

## Negative assertions

- `Ready`'s status does not change.

## Cleanup

Discard the test deployment.
