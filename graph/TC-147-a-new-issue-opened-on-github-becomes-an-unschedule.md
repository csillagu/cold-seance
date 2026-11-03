# TC-147: A new issue opened on GitHub becomes an unscheduled task

Verifies [FR-100](FR-100-create-an-unscheduled-task-for-each-new-issue-open.md).

## Intent

Verify that an issue opened in a repository a project pulls issues from is added to that project as an unscheduled task, whoever opened it.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, as a repository it pulls issues from. GitHub user `tc-writer` has write access to `tc-repo` and no account in the tool.

## Procedure

1. As `tc-writer`, open issue `Crash on start` in `tc-repo`.
2. Within an hour, list the tasks of `Apollo`.

## Expected response

- `Apollo` has a task linked to `Crash on start`, with no planned dates.

## Negative assertions

- The task has no planned start, planned finish or assigned people.

## Cleanup

Delete the issue and uninstall the GitHub App; discard the test deployment.
