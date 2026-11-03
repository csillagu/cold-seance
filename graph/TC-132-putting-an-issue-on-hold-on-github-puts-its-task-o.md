# TC-132: Putting an issue on hold on GitHub puts its task on hold

Verifies [FR-092](FR-092-put-a-task-on-hold-when-it-is-put-on-hold-on-githu.md).

## Intent

Verify that putting a task's issue on hold on GitHub, through the Projects status field, sets the task to on hold.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, and a GitHub Project with a status field that the tool uses; `tc-repo` registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo` and the Project.
- Task `T` in `Apollo`, in progress, planned finish 2027-03-05, assigned to `tc-repo`, so it has issue `#1`.

## Procedure

1. As `tc-writer`, set `#1`'s status field in the GitHub Project to the value for on hold.
2. Within an hour, read `T` through the REST API.

## Expected response

- `T` is on hold.

## Negative assertions

- `T`'s planned finish is still 2027-03-05.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
