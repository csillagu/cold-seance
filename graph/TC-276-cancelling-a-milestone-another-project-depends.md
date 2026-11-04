# TC-276: Cancelling a milestone another project depends on is rejected

Verifies [FR-201](FR-201-refuse-to-cancel-a-milestone-that-blocks-a-task.md).

## Intent

Verify that a milestone that blocks a task of another project cannot be cancelled.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role; project `Hermes` created by `bob`.
- In `Apollo`: floating milestone `M`, not blocked by anything.
- In `Hermes`: task `X`, blocked by `M`.

## Procedure

1. As `alice`, cancel `M` through the REST API.
2. Read `M` back, and `X`'s blocked-by relations as `bob`.

## Expected response

- The REST API reports a rejection.
- `M`'s status is still not started.
- `X` is still blocked by `M`.

## Negative assertions

- `M` is not cancelled, and `X` loses no relation.

## Cleanup

Discard the test deployment.
