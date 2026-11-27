# TC-287: An issue closed before the tool saw it becomes a done task at the next re-check

Verifies [FR-214](FR-214-take-in-at-each-re-check-the-unknown-issues-opened.md).

## Intent

Verify that an issue opened and closed on GitHub while no change notification reaches the system is added to its project at the next re-check, as a done task with the day it was closed as its actual finish.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; re-check interval 60 minutes.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, as a repository it pulls issues from. GitHub user `tc-writer` has write access to `tc-repo`.
- The GitHub App's event delivery to the tool switched off for the test, and no other webhook to the tool.

## Procedure

1. As `tc-writer`, open issue `Fixed already` in `tc-repo`, then close it as completed.
2. List the tasks of `Apollo` at once.
3. List the tasks of `Apollo` again 60 minutes after step 1.

## Expected response

- At step 2, `Apollo` has no task linked to `Fixed already`.
- At step 3, `Apollo` has a task linked to `Fixed already`: done, with the day of step 1 as its actual finish.

## Negative assertions

- The task has no planned start, planned finish or assigned people.
- The re-check does not reopen `Fixed already`.

## Cleanup

Switch the event delivery back on; delete the issue and uninstall the GitHub App; discard the test deployment.
