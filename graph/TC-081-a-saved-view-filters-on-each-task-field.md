# TC-081: A saved view filters on each task field

Verifies [FR-057](FR-057-let-a-saved-view-filter-on-any-task-field.md).

## Intent

Verify that a saved view can filter on any task field.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Two tasks in `Apollo` that differ in every field of the minimum set:
  - `T1`: description `alpha`, status in progress, planned start 2027-03-01, 2 working days, effort `3`, AI share 0%, eligibility `alice`, assigned [`alice`];
  - `T2`: description `beta`, not started, planned start 2027-03-08, 5 working days, effort `8`, AI share 50%, eligibility `bob`, assigned [`bob`].
- One filter per field, each matching `T1` only: title `T1`, description `alpha`, status in progress, planned start 2027-03-01, planned finish 2027-03-02, duration 2, effort `3`, AI share 0%, eligibility containing `alice`, assigned containing `alice`.

## Procedure

1. As `alice`, for each filter, save a personal Kanban view over `Apollo` with that filter and open it.

## Expected response

- Every view can be saved, and each shows `T1`.

## Negative assertions

- No view shows `T2`.

Not stated: the project and linked-issue fields are not exercised here, since both tasks share a project and neither has an issue.

## Cleanup

Discard the test deployment.
