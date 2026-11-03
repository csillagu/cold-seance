# TC-135: Reopening a finished issue sets its task back to in progress

Verifies [FR-094](FR-094-set-a-task-back-to-in-progress-when-its-finished-i.md).

## Intent

Verify that reopening a finished task's issue on GitHub sets the task back to in progress and clears its actual finish.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, done with an actual finish, assigned to `tc-repo`, so it has issue `#1`, closed.

## Procedure

1. As `tc-writer`, reopen `#1`.
2. Within an hour, read `T` through the REST API.

## Expected response

- `T` is in progress.
- `T` has no actual finish.

## Negative assertions

- `T`'s actual start is unchanged.
- `#1` is not closed again by the tool.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
