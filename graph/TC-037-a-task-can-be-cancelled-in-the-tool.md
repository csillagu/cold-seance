# TC-037: A task can be cancelled in the tool

Verifies [FR-027](FR-027-let-a-task-be-cancelled-in-the-tool.md).

## Intent

Verify that a task can be cancelled in the tool.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, not started, not assigned to a repository.

## Procedure

1. As `alice`, cancel `T` through the REST API.
2. Read `T` back.

## Expected response

- The cancel call succeeds.
- `T`'s status is cancelled, and `T` still exists in `Apollo`.

## Negative assertions

- `T` is not deleted.

## Cleanup

Discard the test deployment.
