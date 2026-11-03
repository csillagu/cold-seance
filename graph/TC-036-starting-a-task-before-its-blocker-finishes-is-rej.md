# TC-036: Starting a task before its blocker finishes is rejected

Verifies [FR-026](FR-026-reject-starting-a-blocked-task-before-its-blocker.md).

## Intent

Verify that the system rejects starting a task while a task blocking it has not finished.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: task `A`, in progress; task `B`, blocked by `A`, not started.

## Procedure

1. As `alice`, try to set `B` to in progress through the REST API.
2. Read `B` back.

## Expected response

- The REST API reports a rejection.
- `B` is still not started.

## Negative assertions

- `B` has no actual start.
- `A` is unchanged.

## Cleanup

Discard the test deployment.
