# TC-191: A cancelled task stays on the Kanban in the cancelled column

Verifies [FR-129](FR-129-show-cancelled-tasks-in-the-kanban-s-cancelled-col.md).

## Intent

Verify that a cancelled task is still shown on the Kanban, in its column for cancelled tasks.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`; task `T` in `Apollo`, not started.

## Procedure

1. As `alice`, cancel `T`.
2. Open the Kanban of `Apollo`.

## Expected response

- `T`'s card is in the column for cancelled tasks.

## Negative assertions

- `T`'s card is in no other column.

## Cleanup

Discard the test deployment.
