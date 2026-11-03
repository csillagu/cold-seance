# TC-257: A repository admin removes another admin

Verifies [FR-176](FR-176-let-a-repository-s-admins-remove-other-admins-or-s.md).

## Intent

Verify that any admin of a repository can remove another admin of it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, with `bob` also its admin.

## Procedure

1. As `bob`, remove `alice` as admin of `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- The admins are [`bob`].

## Negative assertions

- `tc-repo` is still registered.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
