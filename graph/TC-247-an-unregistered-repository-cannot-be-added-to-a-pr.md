# TC-247: An unregistered repository cannot be added to a project

Verifies [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md).

## Intent

Verify that a repository that is not registered, and so has no admin, cannot be added to a project.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, not registered in the tool.

## Procedure

1. As `alice`, try to add `tc-repo` to `Apollo`.
2. Read `Apollo`'s repositories.

## Expected response

- The attempt is rejected, or `tc-repo` is not offered.

## Negative assertions

- `tc-repo` is not among `Apollo`'s repositories and is not registered as a side effect.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
