# TC-023: A task can be blocked by another project's milestone

Verifies [FR-015](FR-015-record-a-task-blocked-by-another-project-s-milesto.md).

## Intent

Verify that a task can be blocked by a milestone another project owns, and that the dependency is recorded in the task's project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-only role.
- Milestone `M` in `Borealis`, pinned to 2027-03-12.
- Task `T` in `Apollo`, unassigned, unscheduled.
- The change: make `T` blocked by `M`.

## Procedure

1. As `alice`, save the change through the REST API.
2. Read `T`'s blocked-by relations as `alice`.

## Expected response

- The save succeeds.
- `T` is blocked by `M`, and the relation is held in project `Apollo`.

## Negative assertions

- `M` is unchanged: same date, same project, no new relation recorded in `Borealis`'s plan.

## Cleanup

Discard the test deployment.
