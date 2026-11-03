# TC-146: A status change on GitHub by a read-only member is accepted

Verifies [FR-099](FR-099-accept-status-changes-from-github-whatever-the-per.md).

## Intent

Verify that the system accepts a status change made on GitHub by someone whose role in the tool would not let them make it there.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; `bob` is linked to GitHub user `tc-bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, and a GitHub Project with a status field that the tool uses; `tc-repo` registered in the tool by `alice` and added to project `Apollo`, created by `alice`, where `bob` has the read-only role. `tc-bob` has write access to `tc-repo` and the Project.
- Task `T` in `Apollo`, not started, no blockers, assigned to `tc-repo`, so it has issue `#1`.

## Procedure

1. As `tc-bob`, set `#1`'s status field to the value for started.
2. Within an hour, read `T` and `#1`.

## Expected response

- `T` is in progress.

## Negative assertions

- `#1`'s status field is not reset and gets no revert comment.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
