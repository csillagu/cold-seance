# TC-085: A cross-project view refuses an edit the viewer's role does not allow in the card's project

Verifies [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md).

## Intent

Verify that, in a view covering several projects, the viewer cannot do with a card what their role in the card's project does not allow.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-only role.
- Task `B-task` in `Borealis`, not started, no blockers.
- A personal Kanban view of `alice`'s covering `Apollo` and `Borealis`.

## Procedure

1. As `alice`, open the view and try to move `B-task`'s card to the in-progress column.
2. Read `B-task` back through the REST API.

## Expected response

- The move is refused, or not offered.
- `B-task` is still not started.

## Negative assertions

- `B-task` has no actual start.

## Cleanup

Discard the test deployment.
