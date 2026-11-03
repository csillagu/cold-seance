# TC-149: Seeding imports issues with their relations, assignees and status

Verifies [FR-102](FR-102-seed-a-project-from-one-or-more-github-repositorie.md).

## Intent

Verify that seeding a project imports a repository's issues with their sub-issue and blocked-by relations, their assignees and their Projects status.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, linked to GitHub user `tc-alice`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and a GitHub Project with a status field the tool uses. Open issues: `#1`; `#2`, sub-issue of `#1`, assigned to `tc-alice`, status field set to the value for started; `#3`, blocked by `#2`.
- `tc-seed` registered in the tool by `alice`, so `alice` is its repository admin; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed`.
2. List the tasks of `Apollo` and read each.

## Expected response

- `Apollo` has three tasks, linked to `#1`, `#2` and `#3`.
- The task for `#2` is a subtask of the task for `#1`, is assigned to `alice`, and is in progress.
- The task for `#3` is blocked by the task for `#2`.

## Negative assertions

- No issue on GitHub is changed by the seeding.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
