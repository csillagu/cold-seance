# TC-139: Closing a parent's issue while a subtask is open is reopened

Verifies [FR-095](FR-095-revert-github-status-changes-that-break-a-constrai.md).

## Intent

Verify that the system reopens, within an hour, a parent task's issue closed on GitHub while one of its subtasks is open.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `P` (in progress) with subtask `C` (in progress) in `Apollo`, both assigned to `tc-repo`, with issues `#1` (`P`) and `#2` (`C`, sub-issue of `#1`).

## Procedure

1. As `tc-writer`, close `#1` as completed.
2. Within an hour, read `#1` on GitHub and `P` through the REST API.

## Expected response

- `#1` is open.
- `P` is not done.

## Negative assertions

- `P` has no actual finish; `C` is unchanged.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
