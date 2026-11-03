# TC-043: A task's person-load percentage is 100% minus its AI share

Verifies [FR-032](FR-032-derive-a-task-s-default-person-load-percentage-fro.md).

## Intent

Verify that the system gives each task a person-load percentage of 100% minus its AI share.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T0` in `Apollo` with AI share 0%; task `T50` in `Apollo` with AI share 50%.

## Procedure

1. As `alice`, create both tasks through the REST API.
2. Read each task's person-load percentage.

## Expected response

- `T0`'s person-load percentage is 100%.
- `T50`'s person-load percentage is 50%.

## Negative assertions

- Neither task's duration is changed by its AI share.

## Cleanup

Discard the test deployment.
