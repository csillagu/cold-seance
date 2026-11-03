# TC-185: A group admin adds a member, changes their role and removes them

Verifies [FR-124](FR-124-let-group-admins-manage-the-group-s-members.md).

## Intent

Verify that a member holding the admin role in a group can add people to it with a role, change their role and remove them.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`, so `alice` is its admin; `bob` is not a member.

## Procedure

1. As `alice`, add `bob` to `Platform` with the read role; read `Platform`'s members.
2. Change `bob`'s role to contributor; read it.
3. Remove `bob`; read the members.

## Expected response

- After step 1 `bob` is a member with read, after step 2 with contributor, and after step 3 not a member.

## Negative assertions

- `alice` stays the group's admin throughout.

## Cleanup

Discard the test deployment.
