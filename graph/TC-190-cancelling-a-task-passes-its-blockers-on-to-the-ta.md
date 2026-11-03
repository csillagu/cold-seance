# TC-190: Cancelling a task passes its blockers on to the tasks it blocked

Verifies [FR-128](FR-128-pass-a-cancelled-task-s-blockers-on-to-the-tasks-i.md).

## Intent

Verify that, when a task is cancelled, each task it blocked becomes blocked by whatever it was blocked by.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: tasks `A1` and `A2`; task `B`, blocked by `A1` and `A2`; task `C`, blocked by `B`. All unscheduled and not started.

## Procedure

1. As `alice`, cancel `B`.
2. Read `C`'s blocked-by relations.

## Expected response

- `C` is blocked by `A1` and `A2`.

## Negative assertions

- `C` is no longer blocked by `B`, and no other task gains a relation.

## Cleanup

Discard the test deployment.
