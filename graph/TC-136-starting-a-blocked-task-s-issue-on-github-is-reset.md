# TC-136: Starting a blocked task's issue on GitHub is reset

Verifies [FR-095](FR-095-revert-github-status-changes-that-break-a-constrai.md).

## Intent

Verify that the system reverts, within an hour, a start made on GitHub on a task whose blocker has not finished.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, and a GitHub Project with a status field that the tool uses; `tc-repo` registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo` and the Project.
- Tasks `A` (in progress) and `B` (not started, blocked by `A`) in `Apollo`, both assigned to `tc-repo`, with issues `#1` and `#2`.

## Procedure

1. As `tc-writer`, set `#2`'s status field to the value for started.
2. Within an hour, read `#2`'s status field on GitHub and `B` through the REST API.

## Expected response

- `#2`'s status field is back to its value from before step 1.
- `B` is not started.

## Negative assertions

- `B` has no actual start.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
