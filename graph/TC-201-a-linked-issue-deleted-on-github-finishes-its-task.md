# TC-201: A linked issue deleted on GitHub finishes its task as a close would

Verifies [FR-136](FR-136-treat-a-linked-issue-deleted-on-github-as-closed.md).

## Intent

Verify that a linked issue deleted on GitHub is handled as if it had been closed.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-owner` is an admin of `tc-repo`.
- Task `T` in `Apollo`, in progress, no relations, no subtasks, assigned to `tc-repo`, with issue `#1`.
- `D`: the date on which the test runs.

## Procedure

1. As `tc-owner`, delete `#1`.
2. Within an hour, read `T`.

## Expected response

- `T` is done, with actual finish `D`.

## Negative assertions

- `T` is not cancelled, and no new issue is created for it.

## Cleanup

Uninstall the GitHub App; discard the test deployment.
