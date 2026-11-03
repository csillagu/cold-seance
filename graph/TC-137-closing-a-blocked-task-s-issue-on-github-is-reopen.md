# TC-137: Closing a blocked task's issue on GitHub is reopened

Verifies [FR-095](FR-095-revert-github-status-changes-that-break-a-constrai.md).

## Intent

Verify that the system reopens, within an hour, a blocked task's issue that was closed on GitHub.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` (in progress) and `B` (not started, blocked by `A`) in `Apollo`, both assigned to `tc-repo`, with issues `#1` and `#2`.

## Procedure

1. As `tc-writer`, close `#2` as completed.
2. Within an hour, read `#2` on GitHub and `B` through the REST API.

## Expected response

- `#2` is open.
- `B` is not done.

## Negative assertions

- `B` has no actual finish.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
