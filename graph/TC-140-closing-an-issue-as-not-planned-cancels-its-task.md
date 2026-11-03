# TC-140: Closing an issue as not planned cancels its task

Verifies [FR-096](FR-096-cancel-a-task-when-its-issue-is-closed-as-not-plan.md).

## Intent

Verify that closing a task's issue on GitHub as "not planned" cancels the task.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, not started, no relations, assigned to `tc-repo`, so it has issue `#1`.

## Procedure

1. As `tc-writer`, close `#1` as not planned.
2. Within an hour, read `T` through the REST API.

## Expected response

- `T` is cancelled.

## Negative assertions

- `T` is not done and has no actual finish.
- `#1` is not reopened.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
