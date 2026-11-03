# TC-161: Removing a project's last admin is rejected

Verifies [FR-110](FR-110-keep-at-least-one-admin-on-every-project.md).

## Intent

Verify that the system rejects removing a project's last admin.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, its only admin; `bob` has the read-write role.

## Procedure

1. As `alice`, try to remove `alice` from `Apollo`.
2. Read `Apollo`'s members.

## Expected response

- The removal is rejected.
- `alice` is still `Apollo`'s admin.

## Negative assertions

- `bob` is not made admin as a side effect.

## Cleanup

Discard the test deployment.
