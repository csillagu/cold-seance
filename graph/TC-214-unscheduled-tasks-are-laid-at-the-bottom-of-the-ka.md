# TC-214: Unscheduled tasks are laid at the bottom of the Kanban

Verifies [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md).

## Intent

Verify that the Kanban lays unscheduled tasks at the bottom.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, all not started: unscheduled task `U`, created first; scheduled tasks `S1` (2027-03-01) and `S2` (2027-03-08), created after `U`.

## Procedure

1. As `alice`, open the Kanban of `Apollo`.

## Expected response

- In the column holding all three, `U`'s card is below `S1`'s and `S2`'s.

## Negative assertions

- No scheduled card is below `U`'s.

## Cleanup

Discard the test deployment.
