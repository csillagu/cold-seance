# TC-187: A system admin deletes a group

Verifies [FR-126](FR-126-let-only-system-admins-delete-a-group.md).

## Intent

Verify that a system admin can delete a group.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; group `Platform` created by `alice`; project `Apollo` created by `alice` and added to `Platform`.

## Procedure

1. As `root`, delete `Platform`.
2. List the groups and the projects.

## Expected response

- `Platform` is gone.

## Negative assertions

- `Apollo` still exists, with `alice` as admin.

## Cleanup

Discard the test deployment.
