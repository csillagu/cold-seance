# TC-188: A group admin who is not a system admin cannot delete the group

Verifies [FR-126](FR-126-let-only-system-admins-delete-a-group.md).

## Intent

Verify that only a system admin can delete a group.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, not a system admin; group `Platform` created by `alice`, so `alice` is its admin.

## Procedure

1. As `alice`, try to delete `Platform`.
2. List the groups.

## Expected response

- The deletion is rejected.

## Negative assertions

- `Platform` still exists with its members.

## Cleanup

Discard the test deployment.
