# TC-183: A project's admin adds the existing project to a group

Verifies [FR-123](FR-123-let-anyone-add-a-new-project-to-a-group-and-only-i.md).

## Intent

Verify that an existing project's admin can add it to a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `bob`; project `Apollo` created by `alice` earlier (admin), not in `Platform`. `alice` is not a member of `Platform`.

## Procedure

1. As `alice`, add `Apollo` to `Platform`.
2. List `Platform`'s projects.

## Expected response

- `Apollo` is in `Platform`.

## Negative assertions

- `alice`'s role in `Apollo` is unchanged.

## Cleanup

Discard the test deployment.
