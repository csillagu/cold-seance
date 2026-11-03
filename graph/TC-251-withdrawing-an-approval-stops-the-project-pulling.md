# TC-251: Withdrawing an approval stops the project pulling and keeps its tasks

Verifies [FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md).

## Intent

Verify that a repository admin can withdraw an approval given to a project, which stops the project pulling issues from the repository while it keeps the tasks it already has.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`; added to project `Apollo`, created by `alice`, with `bob`'s approval.
- Task `Old` in `Apollo`, assigned to `tc-repo`, with issue `#1`. Task `New` in `Apollo`, not assigned to a repository.

## Procedure

1. As `bob`, withdraw the approval for `Apollo`.
2. Read `Apollo`'s repositories, then as `alice` try to assign `New` to `tc-repo`.
3. List `Apollo`'s tasks.

## Expected response

- `tc-repo` is no longer among `Apollo`'s repositories, and the assignment at step 2 is rejected.
- `Old` is still in `Apollo`.

## Negative assertions

- `Old` is not deleted or cancelled.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
