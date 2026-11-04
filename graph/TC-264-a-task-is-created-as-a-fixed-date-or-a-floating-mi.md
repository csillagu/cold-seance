# TC-264: A task is created as a fixed-date or a floating milestone

Verifies [FR-190](FR-190-let-a-task-be-made-a-milestone-with-a-fixed-date-o.md).

## Intent

Verify that a task can be made a milestone when it is created, and that whether it is fixed-date, with its date, or floating is recorded.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- Task `Launch` to create in `Apollo`: a milestone, fixed-date, pinned to 2027-03-12.
- Task `Docs ready` to create in `Apollo`: a milestone, floating.
- Task `Write guide` to create in `Apollo`: not a milestone.

## Procedure

1. As `alice`, create the three tasks through the REST API.
2. Read each of them back through the REST API as `alice`.

## Expected response

- All three creations succeed.
- `Launch` reads back as a fixed-date milestone pinned to 2027-03-12.
- `Docs ready` reads back as a floating milestone with no date of its own.
- `Write guide` reads back as a task that is not a milestone.

## Negative assertions

- Neither milestone reads back as a normal task, nor `Write guide` as a milestone.
- `Launch` is not floating, and `Docs ready` is not fixed-date.

## Cleanup

Discard the test deployment.
