# TC-249: An admin of both the repository and the project adds it without approval

Verifies [FR-170](FR-170-add-a-repository-at-once-when-its-adder-is-admin-o.md).

## Intent

Verify that, when the person adding a repository to a project is an admin of both, it is added without a separate approval.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`. Project `Apollo` created by `alice`.

## Procedure

1. As `alice`, add `tc-repo` to `Apollo` to pull its issues.
2. Read `Apollo`'s repositories and `alice`'s pending approvals.

## Expected response

- `tc-repo` is among `Apollo`'s repositories at once.

## Negative assertions

- No approval request is pending for it, and no repository-request notification is sent.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
