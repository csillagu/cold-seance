# TC-039: Assignment is stored as a list separate from eligibility

Verifies [FR-029](FR-029-store-assignment-as-a-concrete-list-of-people.md).

## Intent

Verify that the system stores who will do a task as a concrete list of people, separately from its eligibility expression.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo` with eligibility `alice OR bob` and assigned people [`bob`].
- The change: set `T`'s assigned people to [`alice`].

## Procedure

1. As `alice`, create `T` through the REST API and read it back.
2. Make the change and read `T` back.

## Expected response

- After step 1: eligibility `alice OR bob`, assigned people [`bob`].
- After step 2: eligibility `alice OR bob`, assigned people [`alice`].

## Negative assertions

- Changing the assignment does not change the eligibility expression.

## Cleanup

Discard the test deployment.
