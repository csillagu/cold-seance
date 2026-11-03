# TC-209: Assigning a task to a repository its project does not pull from is rejected

Verifies [FR-141](FR-141-let-a-task-be-assigned-to-a-repository.md).

## Intent

Verify that a task cannot be assigned to a repository its project does not pull issues from.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-other` with the tool's GitHub App installed; registered in the tool by `bob` and not added to project `Apollo`, created by `alice`.
- Task `T` in `Apollo`, not assigned to a repository.

## Procedure

1. As `alice`, try to assign `T` to `tc-other`.
2. Read `T` and list the issues of `tc-other`.

## Expected response

- The assignment is rejected.

## Negative assertions

- `T` is not assigned to any repository, and `tc-other` has no new issue.

## Cleanup

Uninstall the GitHub App from `tc-other`; discard the test deployment.
