# TC-153: A person holds a different role in each project

Verifies [FR-105](FR-105-assign-roles-per-project.md).

## Intent

Verify that the system holds each person's role per project, from read-only, contributor, read-write and admin.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Projects `P1`, `P2`, `P3` and `P4`, created by `alice`.
- `alice` gives `bob` the read-only role in `P1`, contributor in `P2`, read-write in `P3` and admin in `P4`.

## Procedure

1. As `alice`, give the roles.
2. Read `bob`'s role in each project.

## Expected response

- `bob` is read-only in `P1`, contributor in `P2`, read-write in `P3` and admin in `P4`.

## Negative assertions

- No role offered falls outside these four.

## Cleanup

Discard the test deployment.
