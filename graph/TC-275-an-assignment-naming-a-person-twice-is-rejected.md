# TC-275: An assignment naming a person twice is rejected

Verifies [FR-200](FR-200-reject-an-assignment-that-names-a-person-twice.md).

## Intent

Verify that the system rejects an assignment that names the same person more than once, rather than dropping the repeat.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo`, assigned people [`alice`].
- The change: set `T`'s assigned people to [`bob`, `alice`, `bob`].

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports a rejection.
- `T`'s assigned people are still [`alice`].

## Negative assertions

- `T` is not saved with [`bob`, `alice`] or any other list with the repeat dropped.

## Cleanup

Discard the test deployment.
