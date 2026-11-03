# TC-245: One repository admin's approval adds the repository to a project

Verifies [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md).

## Intent

Verify that a repository is added to a project only once one of its admins approves, and that one admin's approval is enough.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`, with `carol` also its admin.
- Project `Apollo` created by `alice`; `alice` is not an admin of `tc-repo`.

## Procedure

1. As `alice`, ask to add `tc-repo` to `Apollo` to pull its issues. Read `Apollo`'s repositories.
2. As `carol`, approve the request. Read `Apollo`'s repositories again.

## Expected response

- After step 1, `tc-repo` is not among them.
- After step 2, it is, without `bob` approving.

## Negative assertions

- `Apollo` gets no task from `tc-repo` before step 2.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
