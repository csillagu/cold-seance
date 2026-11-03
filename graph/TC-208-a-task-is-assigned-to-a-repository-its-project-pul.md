# TC-208: A task is assigned to a repository its project pulls issues from

Verifies [FR-141](FR-141-let-a-task-be-assigned-to-a-repository.md).

## Intent

Verify that a task can be assigned to one of the repositories its project pulls issues from.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, as a repository it pulls issues from.
- Task `T` in `Apollo`, not assigned to a repository.

## Procedure

1. As `alice`, assign `T` to `tc-repo`.
2. Read `T`.

## Expected response

- `T` is assigned to `tc-repo`.

## Negative assertions

- `T` is assigned to no other repository.

## Cleanup

Delete any issue created in `tc-repo` and uninstall the GitHub App; discard the test deployment.
