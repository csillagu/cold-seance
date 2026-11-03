# TC-091: Saving a baseline without the read-write role is rejected

Verifies [FR-065](FR-065-require-the-read-write-role-to-save-a-baseline.md).

## Intent

Verify that the system rejects saving a baseline by someone without the read-write role in the project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- Project `Apollo` created by `alice`; `bob` has the read-only role and `carol` the contributor role in it.
- Task `T` in `Apollo`, planned start 2027-03-01, 1 working day.

## Procedure

1. As `bob`, try to save a baseline of `Apollo` named `bob's` through the REST API.
2. As `carol`, try to save a baseline of `Apollo` named `carol's`.
3. List the baselines of `Apollo`.

## Expected response

- Both attempts are rejected.

## Negative assertions

- `Apollo` has no baselines.

## Cleanup

Discard the test deployment.
