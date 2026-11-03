# TC-071: A field shown on a Kanban card can be edited on the Kanban

Verifies [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md).

## Intent

Verify that a user can edit, in the Kanban view, what the Kanban shows, within what their role allows.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice` (admin).
- Task `T` in `Apollo`, title `Draft`, not started.

## Procedure

1. As `alice`, open the Kanban of `Apollo`.
2. For each field shown on `T`'s card, change it on the Kanban: set the title to `Draft v2`, and move the card to the in-progress column. Repeat for any other field the card shows.
3. Read `T` back through the REST API.

## Expected response

- Each change made at step 2 is saved: `T`'s title is `Draft v2`, its status is in progress, and so for every other field changed.

## Negative assertions

- No field shown on the card needs another view to be edited.

## Cleanup

Discard the test deployment.
