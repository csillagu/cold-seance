# TC-134: A merged pull request that closes an issue finishes its task

Verifies [FR-093](FR-093-finish-a-task-when-its-issue-is-closed-on-github.md).

## Intent

Verify that a merged pull request that closes a task's issue sets the task to done and records its actual finish.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, in progress, no subtasks, not blocking or blocked, assigned to `tc-repo`, so it has issue `#1`.
- A pull request in `tc-repo` by `tc-writer` whose description says `Closes #1`.
- `D`: the date on which the test runs.

## Procedure

1. As `tc-writer`, merge the pull request, so GitHub closes `#1`.
2. Within an hour, read `T` through the REST API.

## Expected response

- `T` is done, with actual finish `D`.

## Negative assertions

- `#1` is not reopened.

## Cleanup

Delete `#1`, revert the merge commit and uninstall the GitHub App; discard the test deployment.
