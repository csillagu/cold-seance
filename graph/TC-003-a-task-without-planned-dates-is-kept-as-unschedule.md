# TC-003: A task without planned dates is kept as unscheduled in its project

Verifies [FR-003](FR-003-keep-a-task-without-planned-dates-as-unscheduled-i.md).

## Intent

Verify that the system accepts a task with no planned dates and keeps it in its project as an unscheduled task, with no separate inbox.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `Triage backlog` in `Apollo` with a title only: no planned start, no planned finish and no duration.

## Procedure

1. As `alice`, create `Triage backlog` through the REST API.
2. List the tasks of `Apollo` through the REST API.
3. Read `Triage backlog` back.

## Expected response

- The create call succeeds.
- `Triage backlog` appears in the task list of `Apollo` alongside its other tasks.
- Read back, it has project `Apollo`, no planned start and no planned finish.

## Negative assertions

- The task is not held in any list, inbox or container other than project `Apollo`.
- No planned dates are filled in for it.

## Cleanup

Discard the test deployment.
