# TC-164: Of a direct read role and a group write role, write applies

Verifies [FR-112](FR-112-apply-the-highest-of-a-person-s-roles-on-a-project.md).

## Intent

Verify that, where a person holds more than one role on a project, the highest applies.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`, where `bob` has the read-only role directly.
- Group `Platform` created by `alice`, with `bob` as a member with the write role; `Apollo` added to `Platform`.
- Task `T` in `Apollo`, title `Draft`.

## Procedure

1. As `bob`, change `T`'s title to `Final` through the REST API.

## Expected response

- The edit is accepted and `T`'s title is `Final`.

## Negative assertions

- `bob`'s direct role is still read-only: it is not rewritten.

## Cleanup

Discard the test deployment.
