# TC-215: Unscheduled tasks are laid at the bottom of the Gantt

Verifies [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md).

## Intent

Verify that the Gantt lays unscheduled tasks at the bottom.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `U`, created first; scheduled tasks `S1` (2027-03-01) and `S2` (2027-03-08), created after `U`.

## Procedure

1. As `alice`, open the Gantt of `Apollo`.

## Expected response

- `U`'s row is below the rows of `S1` and `S2`.

## Negative assertions

- No scheduled task's row is below `U`'s.

## Cleanup

Discard the test deployment.
