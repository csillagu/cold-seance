# TC-066: A cross-project Kanban has one column per task status

Verifies [FR-048](FR-048-lay-out-the-kanban-in-columns-by-task-status.md).

## Intent

Verify that a Kanban covering several projects also shows one column per task status, with the tasks of every covered project in the column of their status.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-only role.
- Task `A-doing` in `Apollo`, in progress; task `B-doing` in `Borealis`, in progress; task `B-paused` in `Borealis`, on hold.
- A personal saved Kanban of `alice`'s covering `Apollo` and `Borealis`, with no filter.

## Procedure

1. As `alice`, open the saved Kanban.

## Expected response

- `A-doing` and `B-doing` are in the same in-progress column.
- `B-paused` is in the on-hold column.

## Negative assertions

- The view does not split the columns per project.

## Cleanup

Discard the test deployment.
