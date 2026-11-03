# TC-192: A cancelled task stays on the Gantt, faded

Verifies [FR-129](FR-129-show-cancelled-tasks-in-the-kanban-s-cancelled-col.md).

## Intent

Verify that a cancelled task is still shown on the Gantt, somewhat opaque.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Tasks `T` and `U` in `Apollo`, each 2027-03-01, 1 working day, not started.

## Procedure

1. As `alice`, cancel `T`.
2. Open the Gantt of `Apollo`.

## Expected response

- `T`'s bar is still shown, on 2027-03-01, visibly fainter than `U`'s.

## Negative assertions

- `U` is drawn as before.

## Cleanup

Discard the test deployment.
