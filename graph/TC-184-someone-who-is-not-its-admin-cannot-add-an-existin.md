# TC-184: Someone who is not its admin cannot add an existing project to a group

Verifies [FR-123](FR-123-let-anyone-add-a-new-project-to-a-group-and-only-i.md).

## Intent

Verify that only an existing project's admin can add it to a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `bob`; project `Apollo` created by `alice` earlier, where `bob` has the read-write role.

## Procedure

1. As `bob`, try to add `Apollo` to `Platform`.
2. List `Platform`'s projects.

## Expected response

- The attempt is rejected.

## Negative assertions

- `Apollo` is not in `Platform`, and `Platform`'s members get no role on it.

## Cleanup

Discard the test deployment.
