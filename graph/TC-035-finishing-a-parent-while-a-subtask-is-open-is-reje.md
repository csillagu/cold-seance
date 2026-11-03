# TC-035: Finishing a parent while a subtask is open is rejected

Verifies [FR-025](FR-025-reject-finishing-a-parent-task-while-a-subtask-is.md).

## Intent

Verify that the system rejects finishing a parent task while one of its subtasks is still open.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: parent task `P`, in progress, with subtasks `C1` (done) and `C2` (in progress).

## Procedure

1. As `alice`, try to set `P` to done through the REST API.
2. Read `P` back.

## Expected response

- The REST API reports a rejection.
- `P`'s status is still in progress.

## Negative assertions

- `P` has no actual finish.
- `C1` and `C2` are unchanged.

## Cleanup

Discard the test deployment.
