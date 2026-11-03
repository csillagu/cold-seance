# TC-248: A system admin changes a repository's admins

Verifies [FR-169](FR-169-let-system-admins-change-a-repository-s-admins.md).

## Intent

Verify that a system admin can change who the admins of a registered repository are.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, its only admin. `root` is not one of its admins.

## Procedure

1. As `root`, add `bob` as an admin of `tc-repo`, then remove `alice`.
2. Read `tc-repo`'s admins.

## Expected response

- `tc-repo`'s admins are [`bob`].

## Negative assertions

- `root` has not become one of its admins.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
