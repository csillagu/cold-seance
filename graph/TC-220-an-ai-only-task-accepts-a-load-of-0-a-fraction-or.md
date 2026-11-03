# TC-220: An AI-only task accepts a load of 0%, a fraction or over 100%

Verifies [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md).

## Intent

Verify that the system accepts any person-load percentage for an AI-only task, including 0%, a fraction of a percent and a value above 100%.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, AI share 100%, assigned to `alice`.
- The values to set as `T`'s person-load percentage, one after the other: 0%, 0.5%, 150%.

## Procedure

1. As `alice`, set each value through the REST API, reading `T` back after each.

## Expected response

- Each value is accepted and read back exactly: 0%, then 0.5%, then 150%.

## Negative assertions

- No value is rounded, clamped or rejected.

## Cleanup

Discard the test deployment.
