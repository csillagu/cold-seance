# TC-033: Finishing a task in the tool records its actual finish

Verifies [FR-023](FR-023-record-a-task-s-actual-finish-when-it-is-finished.md).

## Intent

Verify that finishing a task in the tool records its actual finish.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, already in progress, no subtasks, no actual finish.
- `D`: the date on which the test runs, in the deployment's time zone.

## Procedure

1. As `alice`, set `T` to done through the REST API.
2. Read `T` back.

## Expected response

- `T`'s status is done.
- `T`'s actual finish is `D`.

## Negative assertions

- `T`'s actual start is unchanged.
- `T`'s planned start and planned finish are unchanged.

## Cleanup

Discard the test deployment.
