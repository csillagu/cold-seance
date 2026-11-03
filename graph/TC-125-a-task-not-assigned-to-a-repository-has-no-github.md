# TC-125: A task not assigned to a repository has no GitHub issue

Verifies [FR-088](FR-088-create-a-task-s-github-issue-once-it-is-assigned-t.md).

## Intent

Verify that a task not assigned to a repository has no GitHub issue.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with no issues and the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Task `Local only` in `Apollo`, planned start 2027-03-01, 2 working days, assigned to `alice`, not assigned to a repository.

## Procedure

1. As `alice`, create `Local only`.
2. Wait one hour, then list the issues of `tc-repo` and read `Local only` back.

## Expected response

- `Local only` has no linked GitHub issue.

## Negative assertions

- `tc-repo` has no issues.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
