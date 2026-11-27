# TC-288: The re-check leaves out issues opened before their repository was added

Verifies [FR-214](FR-214-take-in-at-each-re-check-the-unknown-issues-opened.md).

## Intent

Verify that the re-check does not add an issue that was opened before its repository was added to the project, which is left to seeding.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; re-check interval 60 minutes.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed and one open issue, `#1 Old work`, registered in the tool by `alice`; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, add `tc-repo` to `Apollo` as a repository it pulls issues from, without seeding `Apollo`.
2. List the tasks of `Apollo` 60 minutes after step 1.
3. As `alice`, seed `Apollo` from `tc-repo`.

## Expected response

- At step 2, `Apollo` has no tasks.
- At step 3, the seeding imports `#1` as a task of `Apollo`.

## Negative assertions

- No task in any project is linked to `#1` before step 3.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
