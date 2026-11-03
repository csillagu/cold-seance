# TC-160: A project admin manages the project's members and roles

Verifies [FR-109](FR-109-let-a-project-admin-manage-members-roles-repositor.md).

## Intent

Verify that a project's admin can manage its members and their roles.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice` (admin); `bob` not a member.

## Procedure

1. As `alice`, add `bob` to `Apollo` with the read-only role; read `bob`'s role.
2. Change `bob`'s role to read-write; read it.
3. Remove `bob` from `Apollo`; read `Apollo`'s members.

## Expected response

- After step 1 `bob` is read-only, after step 2 read-write, and after step 3 not a member.

## Negative assertions

- `alice`'s own role stays admin throughout.

## Cleanup

Discard the test deployment.
