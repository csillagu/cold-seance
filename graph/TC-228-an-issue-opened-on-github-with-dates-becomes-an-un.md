# TC-228: An issue opened on GitHub with dates becomes an unscheduled task

Verifies [FR-156](FR-156-never-create-a-planned-task-from-github.md).

## Intent

Verify that the system never creates a planned task from GitHub.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed and a GitHub Project with date fields; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, as a repository it pulls issues from. GitHub user `tc-writer` has write access to `tc-repo` and the Project.

## Procedure

1. As `tc-writer`, open issue `Dated` in `tc-repo`, add it to the GitHub Project, and fill its date fields with 2027-03-01 to 2027-03-05.
2. Within an hour, read the task created for `Dated` in `Apollo`.

## Expected response

- The task for `Dated` exists and has no planned start and no planned finish.

## Negative assertions

- The task is not scheduled on 2027-03-01 to 2027-03-05 or any other dates.

## Cleanup

Delete the issue and uninstall the GitHub App; discard the test deployment.
