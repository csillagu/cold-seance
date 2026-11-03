# TC-073: Named Kanban and Gantt views can be saved

Verifies [FR-054](FR-054-let-users-save-named-kanban-and-gantt-views.md).

## Intent

Verify that users can create and keep named saved views of the Kanban and Gantt kinds.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- A Kanban view of `Apollo` named `Team board`, filtered to status in progress, kept personally.
- A Gantt view of `Apollo` named `Q1 plan`, with no filter, kept personally.

## Procedure

1. As `alice`, create and save both views.
2. Sign out, sign in again as `alice`, and list her saved views.
3. Open each one.

## Expected response

- `Team board` and `Q1 plan` are listed under those names.
- `Team board` opens as a Kanban with its filter; `Q1 plan` opens as a Gantt.

## Negative assertions

- Neither view changes any task.

## Cleanup

Discard the test deployment.
