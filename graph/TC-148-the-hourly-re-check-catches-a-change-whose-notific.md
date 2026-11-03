# TC-148: The hourly re-check catches a change whose notification never arrived

Verifies [FR-101](FR-101-re-check-all-linked-issues-every-hour.md).

## Intent

Verify that the hourly re-check of linked issues catches a change the system missed, and handles it as if it had just arrived.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, in progress, no relations, assigned to `tc-repo`, so it has issue `#1`.
- The GitHub App's event delivery to the tool switched off for the test.

## Procedure

1. As `tc-writer`, close `#1` as completed.
2. Read `T` at once and confirm it is still in progress.
3. Read `T` again 60 minutes after step 1.

## Expected response

- At step 3, `T` is done with an actual finish, as it would be had the close arrived at once.

## Negative assertions

- The re-check does not reopen `#1`.

## Cleanup

Switch the event delivery back on; delete `#1` and uninstall the GitHub App; discard the test deployment.
