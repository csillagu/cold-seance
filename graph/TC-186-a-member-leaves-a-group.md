# TC-186: A member leaves a group

Verifies [FR-125](FR-125-let-a-member-leave-a-group.md).

## Intent

Verify that a member can leave a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`, with `bob` as a member with the read role.

## Procedure

1. As `bob`, leave `Platform`.
2. Read `Platform`'s members.

## Expected response

- `bob` is not a member.

## Negative assertions

- `alice` is still a member and admin.

## Cleanup

Discard the test deployment.
