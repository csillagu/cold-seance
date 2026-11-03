# TC-042: Assigning someone without read access is rejected

Verifies [FR-031](FR-031-reject-eligibility-or-assignment-for-someone-witho.md).

## Intent

Verify that the system rejects assigning a person to a task in a project they cannot read.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `dave`.
- Project `Apollo` created by `alice`; `dave` has no role in it, directly or through a group.
- Task `T` in `Apollo`, no assigned people.
- The change: set `T`'s assigned people to [`dave`].

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `T` back.

## Expected response

- The REST API reports a rejection.
- `T` still has no assigned people.

## Negative assertions

- `dave` gains no access to `Apollo` and carries no load from `T`.

## Cleanup

Discard the test deployment.
