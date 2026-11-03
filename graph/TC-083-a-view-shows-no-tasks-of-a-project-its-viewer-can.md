# TC-083: A view shows no tasks of a project its viewer can no longer read

Verifies [FR-059](FR-059-show-in-a-view-only-the-tasks-its-viewer-can-read.md).

## Intent

Verify that a view shows only the tasks its viewer can read, so that a view never grants access.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`, with task `A-task`; project `Borealis` created by `bob`, with task `B-task`, where `alice` has the read-only role.
- A personal Kanban view of `alice`'s covering `Apollo` and `Borealis`, saved while `alice` could read both.
- The change: `bob` removes `alice` from `Borealis`.

## Procedure

1. As `alice`, open the view and confirm it shows `A-task` and `B-task`.
2. As `bob`, make the change.
3. As `alice`, open the view again.

## Expected response

- At step 3 the view shows `A-task`.

## Negative assertions

- At step 3 the view does not show `B-task` or any other data of `Borealis`.

## Cleanup

Discard the test deployment.
