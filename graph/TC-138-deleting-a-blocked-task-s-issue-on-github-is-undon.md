# TC-138: Deleting a blocked task's issue on GitHub is undone by recreating it

Verifies [FR-095](FR-095-revert-github-status-changes-that-break-a-constrai.md).

## Intent

Verify that the system recreates, within an hour, a blocked task's issue that was deleted on GitHub.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-owner` is an admin of `tc-repo`, so they can delete issues.
- Tasks `A` (in progress) and `B` (not started, blocked by `A`) in `Apollo`, both assigned to `tc-repo`, with issues `#1` and `#2`.

## Procedure

1. As `tc-owner`, delete `#2`.
2. Within an hour, list the open issues of `tc-repo` and read `B` through the REST API.

## Expected response

- A new open issue for `B` exists in `tc-repo`, blocked by `#1`, and `B`'s linked issue is that new issue.
- `B` is not done.

## Negative assertions

- `B` has no actual finish and is not cancelled.

## Cleanup

Delete all issues from `tc-repo` and uninstall the GitHub App; discard the test deployment.
