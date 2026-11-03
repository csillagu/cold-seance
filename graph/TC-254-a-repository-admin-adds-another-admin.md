# TC-254: A repository admin adds another admin

Verifies [FR-174](FR-174-let-a-repository-s-admins-add-other-admins.md).

## Intent

Verify that any admin of a repository can make another person an admin of it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, its only admin.

## Procedure

1. As `alice`, make `bob` an admin of `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- The admins are [`alice`, `bob`].

## Negative assertions

- `alice` is still an admin.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
