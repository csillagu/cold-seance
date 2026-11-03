# TC-145: A status change on GitHub by someone with no tool account is accepted

Verifies [FR-099](FR-099-accept-status-changes-from-github-whatever-the-per.md).

## Intent

Verify that the system accepts a status change made on GitHub by someone who has no account in the tool.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo` and is not linked to any account in the tool.
- Task `T` in `Apollo`, in progress, no relations, assigned to `tc-repo`, so it has issue `#1`.

## Procedure

1. As `tc-writer`, close `#1` as completed.
2. Within an hour, read `T` and `#1`.

## Expected response

- `T` is done.

## Negative assertions

- `#1` is not reopened and gets no revert comment.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
