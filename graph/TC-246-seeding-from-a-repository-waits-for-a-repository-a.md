# TC-246: Seeding from a repository waits for a repository admin's approval

Verifies [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md).

## Intent

Verify that a repository is added to a project for seeding only once one of the repository's admins has approved it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and open issue `#1`; registered in the tool by `bob`, its only admin.
- Project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, ask to seed `Apollo` from `tc-seed`. List `Apollo`'s tasks.
2. As `bob`, approve. As `alice`, run the seeding and list `Apollo`'s tasks.

## Expected response

- After step 1, `Apollo` has no tasks.
- After step 2, `Apollo` has a task for `#1`.

## Negative assertions

- No issue of `tc-seed` is imported before `bob`'s approval.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
