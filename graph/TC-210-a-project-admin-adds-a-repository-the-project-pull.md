# TC-210: A project admin adds a repository the project pulls issues from, once approved

Verifies [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md).

## Intent

Verify that a project's admin can set a repository as one the project pulls issues from, taking effect once one of the repository's admins has approved it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`, its only repository admin.
- Project `Apollo` created by `alice`; `bob` has no role in it.

## Procedure

1. As `alice`, set `tc-repo` as a repository `Apollo` pulls issues from. Read `Apollo`'s repositories.
2. As `bob`, approve the request. Read `Apollo`'s repositories again.

## Expected response

- After step 1, `tc-repo` is not yet among `Apollo`'s repositories.
- After step 2, it is.

## Negative assertions

- `bob` gains no role in `Apollo`.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
