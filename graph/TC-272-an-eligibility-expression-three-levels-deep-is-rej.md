# TC-272: An eligibility expression three levels deep is rejected

Verifies [FR-197](FR-197-reject-an-eligibility-expression-nested-deeper-tha.md).

## Intent

Verify that the system rejects an eligibility expression nested deeper than two levels and keeps the task's eligibility as it was.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob`, `carol` and `dave`.
- Project `Apollo` created by `alice`; `bob`, `carol` and `dave` have the read-only role in it.
- Task `T` in `Apollo`, eligibility `alice OR bob`.
- The change: set `T`'s eligibility to `alice AND (bob OR (carol AND dave))`, three levels deep.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports a rejection.
- `T`'s eligibility is still `alice OR bob`.

## Negative assertions

- No part of the three-level expression is stored, flattened or cut down to two levels.

## Cleanup

Discard the test deployment.
