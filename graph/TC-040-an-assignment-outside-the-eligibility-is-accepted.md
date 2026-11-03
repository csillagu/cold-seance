# TC-040: An assignment outside the eligibility is accepted without a warning

Verifies [FR-030](FR-030-accept-an-assignment-that-includes-people-outside.md).

## Intent

Verify that the system accepts an assignment that includes a person outside the task's eligibility expression, with no rejection and no warning.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- Project `Apollo` created by `alice`; `bob` and `carol` have the read-only role in it.
- Task `T` in `Apollo`, eligibility `alice OR bob`, no assigned people.

## Procedure

1. As `alice`, open `T` in the browser and set its assigned people to [`carol`]. Save.
2. Read `T` back through the REST API.

## Expected response

- The save succeeds.
- `T`'s assigned people are [`carol`]; its eligibility is still `alice OR bob`.

## Negative assertions

- No warning, confirmation prompt or error is shown at step 1.
- No notification is raised about the assignment being outside the eligibility.

## Cleanup

Discard the test deployment.
