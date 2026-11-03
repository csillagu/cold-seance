# TC-233: Deleting a group deletes its saved views

Verifies [FR-161](FR-161-delete-a-group-s-saved-views-with-the-group.md).

## Intent

Verify that, when a group is deleted, its saved views are deleted with it.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- Group `Platform` created by `alice`; project `Apollo` created by `alice` and added to `Platform`.
- Saved views: `Group board`, kept in `Platform`; `Project board`, kept in `Apollo`; `My board`, kept personally by `alice`.

## Procedure

1. As `root`, delete `Platform`.
2. As `alice`, list every saved view they can see.

## Expected response

- `Group board` is gone.

## Negative assertions

- `Project board` and `My board` still exist.

## Cleanup

Discard the test deployment.
