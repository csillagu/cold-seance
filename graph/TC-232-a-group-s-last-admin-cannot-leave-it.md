# TC-232: A group's last admin cannot leave it

Verifies [FR-160](FR-160-keep-at-least-one-admin-in-every-group.md).

## Intent

Verify that the system rejects the last admin of a group leaving it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`, its only admin, with `bob` as a member with the write role.

## Procedure

1. As `alice`, try to leave `Platform`.
2. Read `Platform`'s members.

## Expected response

- The attempt is rejected.
- `alice` is still a member and admin.

## Negative assertions

- `bob`'s role is unchanged: `bob` is not made admin as a side effect.

## Cleanup

Discard the test deployment.
