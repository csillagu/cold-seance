# TC-158: A read-write member edits tasks, plans and assignments

Verifies [FR-108](FR-108-let-the-read-write-role-edit-the-plan-and-handle-p.md).

## Intent

Verify that a person with the read-write role in a project can edit its tasks, plans and assignments.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `T` in `Apollo`, title `Draft`, 2027-03-01, 1 working day, no assigned people.
- Edits by `bob`: create task `New`; change `T`'s title to `Final`; move `T` to 2027-03-02; assign `alice` to `T`.

## Procedure

1. As `bob`, make each edit through the REST API.
2. Read `Apollo`'s tasks.

## Expected response

- Each edit is accepted: task `New` exists, and `T` is titled `Final`, starts 2027-03-02 and is assigned to `alice`.

## Negative assertions

- No edit is rejected.

## Cleanup

Discard the test deployment.
