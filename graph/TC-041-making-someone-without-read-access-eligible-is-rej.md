# TC-041: Making someone without read access eligible is rejected

Verifies [FR-031](FR-031-reject-eligibility-or-assignment-for-someone-witho.md).

## Intent

Verify that the system rejects making a person eligible for a task in a project they cannot read.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `dave`.
- Project `Apollo` created by `alice`; `dave` has no role in it, directly or through a group.
- Task `T` in `Apollo`, eligibility `alice`.
- The change: set `T`'s eligibility to `alice OR dave`.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports a rejection.
- `T`'s eligibility is still `alice`.

## Negative assertions

- `dave` gains no access to `Apollo`.

## Cleanup

Discard the test deployment.
