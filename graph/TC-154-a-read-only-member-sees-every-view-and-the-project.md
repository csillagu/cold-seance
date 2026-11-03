# TC-154: A read-only member sees every view and the project's data

Verifies [FR-106](FR-106-let-the-read-only-role-view-everything-and-edit-no.md).

## Intent

Verify that a person with the read-only role in a project can see all its views and data.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- In `Apollo`: task `T` (2027-03-01, 1 working day, assigned to `alice`); a baseline `v1`; a Kanban view `Board` kept in `Apollo`.

## Procedure

1. As `bob`, open the Kanban, the Gantt, the person load view, the baseline variance view and `Board` for `Apollo`.
2. Read `T` and `v1` through the REST API.

## Expected response

- Every view opens and shows `T`, and both reads succeed.

## Negative assertions

- No view refuses `bob` access.

## Cleanup

Discard the test deployment.
