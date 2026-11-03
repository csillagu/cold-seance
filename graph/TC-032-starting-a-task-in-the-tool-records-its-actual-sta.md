# TC-032: Starting a task in the tool records its actual start

Verifies [FR-022](FR-022-record-a-task-s-actual-start-when-it-is-started.md).

## Intent

Verify that starting a task in the tool records its actual start.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, not started, no blockers, no actual start.
- `D`: the date on which the test runs, in the deployment's time zone.

## Procedure

1. As `alice`, set `T` to in progress through the REST API.
2. Read `T` back.

## Expected response

- `T`'s status is in progress.
- `T`'s actual start is `D`.

## Negative assertions

- `T` has no actual finish.
- `T`'s planned start and planned finish are unchanged.

## Cleanup

Discard the test deployment.
