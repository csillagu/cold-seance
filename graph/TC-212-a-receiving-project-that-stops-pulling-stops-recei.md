# TC-212: A receiving project that stops pulling stops receiving new issues

Verifies [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md).

## Intent

Verify that, when the receiving project stops pulling issues from the repository, it stops receiving the repository's new issues.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`; added to project `Apollo`, created by `alice`, which pulls issues from it and is marked as its receiving project. GitHub user `tc-writer` has write access to `tc-repo`.

## Procedure

1. As `alice`, remove `tc-repo` from the repositories `Apollo` pulls issues from.
2. As `tc-writer`, open issue `After removal` in `tc-repo`.
3. One hour later, list the tasks of `Apollo`.

## Expected response

- `Apollo` has no task for `After removal`.

## Negative assertions

- Tasks `Apollo` already had from `tc-repo`, if any, remain.

Not stated: which project, if any, then receives `tc-repo`'s new issues; this test does not check it.

## Cleanup

Delete the issue and uninstall the GitHub App; discard the test deployment.
