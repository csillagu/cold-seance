# TC-277: Cancelling a finished task is rejected

Verifies [FR-202](FR-202-refuse-to-cancel-a-finished-task.md).

## Intent

Verify that a task that is done cannot be cancelled.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, started and then finished.

## Procedure

1. As `alice`, cancel `T` through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports a rejection.
- `T`'s status is still done, with the same actual start and finish.

## Negative assertions

- `T` is not cancelled.

## Cleanup

Discard the test deployment.
