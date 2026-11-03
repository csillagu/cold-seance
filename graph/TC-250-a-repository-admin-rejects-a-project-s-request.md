# TC-250: A repository admin rejects a project's request

Verifies [FR-171](FR-171-let-a-repository-admin-reject-a-project-s-request-.md).

## Intent

Verify that any admin of a repository can reject a project's request to add it, and the repository then stays out of the project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`.
- Project `Apollo` created by `alice`, which has asked to add `tc-repo`.

## Procedure

1. As `bob`, reject the request.
2. Read `Apollo`'s repositories and the request's state.

## Expected response

- The request is rejected.

## Negative assertions

- `tc-repo` is not among `Apollo`'s repositories, and the request can no longer be approved.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
