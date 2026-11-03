# TC-193: Cancelling a task closes its GitHub issue as not planned

Verifies [FR-130](FR-130-close-a-cancelled-task-s-github-issue-as-not-plann.md).

## Intent

Verify that cancelling a task in the tool closes its GitHub issue as "not planned".

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Task `T` in `Apollo`, not started, assigned to `tc-repo`, with open issue `#1`.

## Procedure

1. As `alice`, cancel `T` in the tool.
2. Within an hour, read `#1` on GitHub.

## Expected response

- `#1` is closed with the reason "not planned".

## Negative assertions

- `#1` is not closed as completed, and is not deleted.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
