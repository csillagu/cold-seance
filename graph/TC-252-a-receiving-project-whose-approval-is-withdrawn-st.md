# TC-252: A receiving project whose approval is withdrawn stops receiving new issues

Verifies [FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md).

## Intent

Verify that, when the withdrawn project is the repository's receiving project, it stops receiving the repository's new issues.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`; added to project `Apollo`, created by `alice`, with `bob`'s approval, and marked with `Apollo` as its receiving project. GitHub user `tc-writer` has write access to `tc-repo`.

## Procedure

1. As `bob`, withdraw the approval for `Apollo`.
2. As `tc-writer`, open issue `After withdrawal` in `tc-repo`.
3. One hour later, list `Apollo`'s tasks.

## Expected response

- `Apollo` has no task for `After withdrawal`.

## Negative assertions

- No earlier task of `Apollo` is removed.

Not stated: which project, if any, then receives `tc-repo`'s new issues; this test does not check it.

## Cleanup

Delete the issue and uninstall the GitHub App; discard the test deployment.
