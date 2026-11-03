# TC-065: A project's Kanban has one column per task status

Verifies [FR-048](FR-048-lay-out-the-kanban-in-columns-by-task-status.md).

## Intent

Verify that a project's Kanban shows one column per task status, each task in the column of its status.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, one task per status: `New` (never started, in the status a new task has), `Doing` (in progress), `Paused` (on hold), `Finished` (done) and `Dropped` (cancelled).

## Procedure

1. As `alice`, open the Kanban of `Apollo` in the browser.

## Expected response

- There is one column for each of the five statuses.
- Each task's card is in the column of its own status.

## Negative assertions

- No status has two columns, and no card appears in more than one column.

## Cleanup

Discard the test deployment.
