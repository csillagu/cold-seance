# TC-229: A shared repository's new issue goes only to its receiving project

Verifies [FR-157](FR-157-send-a-shared-repository-s-new-issues-to-its-recei.md).

## Intent

Verify that, where several projects pull issues from the same repository, a new issue goes to the receiving project only.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`; added to project `Apollo`, created by `alice`, and to project `Borealis`, created by `bob`, both pulling issues from it. `Apollo` is marked as the receiving project. GitHub user `tc-writer` has write access to `tc-repo`.

## Procedure

1. As `tc-writer`, open issue `Shared bug` in `tc-repo`.
2. Within an hour, list the tasks of `Apollo` and of `Borealis`.

## Expected response

- `Apollo` has an unscheduled task for `Shared bug`.

## Negative assertions

- `Borealis` has no task for `Shared bug`.

## Cleanup

Delete the issue and uninstall the GitHub App; discard the test deployment.
