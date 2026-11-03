# TC-084: A cross-project view allows an edit the viewer's role allows in the card's project

Verifies [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md).

## Intent

Verify that, in a view covering several projects, the viewer can do with a card what their role in the card's project allows, including a role held through a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `bob`, with `alice` added as a member with the write role; project `Borealis` created by `bob`, added to `Platform`; `alice` has no direct role in `Borealis`.
- Project `Apollo` created by `alice`.
- Task `B-task` in `Borealis`, not started, no blockers.
- A personal Kanban view of `alice`'s covering `Apollo` and `Borealis`.

## Procedure

1. As `alice`, open the view and move `B-task`'s card to the in-progress column.
2. Read `B-task` back through the REST API.

## Expected response

- The move is accepted and `B-task` is in progress.

## Negative assertions

- No task in `Apollo` changes.

## Cleanup

Discard the test deployment.
