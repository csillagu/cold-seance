# TC-124: A task assigned to a repository gets its GitHub issue there

Verifies [FR-088](FR-088-create-a-task-s-github-issue-once-it-is-assigned-t.md).

## Intent

Verify that, once a task is assigned to a repository, the system creates the task's GitHub issue in that repository.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with no issues and the tool's GitHub App installed by its owner; registered in the tool by `alice` (so `alice` is its repository admin) and added to project `Apollo`, created by `alice`.
- Task `Write guide` in `Apollo`, not assigned to a repository.
- The change: assign `Write guide` to `tc-repo`.

## Procedure

1. As `alice`, make the change through the REST API.
2. Within an hour, list the issues of `tc-repo` on GitHub and read `Write guide` back.

## Expected response

- `tc-repo` has one new issue for `Write guide`.
- `Write guide`'s linked GitHub issue is that issue.

## Negative assertions

- No issue is created in any other repository.

## Cleanup

Delete the issue from `tc-repo` and uninstall the GitHub App; discard the test deployment.
