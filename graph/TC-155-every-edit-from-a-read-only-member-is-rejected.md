# TC-155: Every edit from a read-only member is rejected

Verifies [FR-106](FR-106-let-the-read-only-role-view-everything-and-edit-no.md).

## Intent

Verify that the system rejects every edit from a person with the read-only role.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo`, title `Draft`, not started, no blockers.
- Edits, each made by `bob` through the REST API: change `T`'s title to `Mine`; set `T` to in progress; create a task `New`; delete `T`; assign `bob` to `T`.

## Procedure

1. Try each edit in turn.
2. Read `Apollo`'s tasks.

## Expected response

- Each edit is rejected.

## Negative assertions

- `T` is unchanged, not started and unassigned, and no task `New` exists.

## Cleanup

Discard the test deployment.
