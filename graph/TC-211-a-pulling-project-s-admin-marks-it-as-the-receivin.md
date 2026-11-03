# TC-211: A pulling project's admin marks it as the receiving project

Verifies [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md).

## Intent

Verify that the admin of a project pulling issues from a repository can mark that project as the repository's receiving project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`; added to project `Apollo`, created by `alice`, and to project `Borealis`, created by `bob`, as a repository both pull issues from. Neither is marked as receiving.

## Procedure

1. As `bob`, mark `Borealis` as the receiving project for `tc-repo`.
2. Read `tc-repo`'s receiving project.

## Expected response

- `Borealis` is the receiving project for `tc-repo`.

## Negative assertions

- `Apollo` is not marked as receiving.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
