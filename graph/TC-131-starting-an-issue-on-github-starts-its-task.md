# TC-131: Starting an issue on GitHub starts its task

Verifies [FR-091](FR-091-start-a-task-when-it-is-started-on-github.md).

## Intent

Verify that starting a task's issue on GitHub, through the Projects status field, sets the task to in progress and records its actual start.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, and a GitHub Project with a status field that the tool uses; `tc-repo` registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo` and the Project.
- Task `T` in `Apollo`, not started, no blockers, assigned to `tc-repo`, so it has issue `#1`.
- `D`: the date on which the test runs.

## Procedure

1. As `tc-writer`, set `#1`'s status field in the GitHub Project to the value for started.
2. Within an hour, read `T` through the REST API.

## Expected response

- `T` is in progress.
- `T`'s actual start is `D`.

## Negative assertions

- No revert is made on `#1`, and no comment is added to it.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
