# TC-267: A milestone cannot be a subtask or a parent

Verifies [FR-193](FR-193-reject-a-milestone-as-a-subtask-or-a-parent.md).

## Intent

Verify that the system rejects making a milestone a subtask, and making a task a subtask of a milestone.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `Build`, with no parent and no subtasks; fixed-date milestone `Launch`, pinned to 2027-03-12.
- The changes: make `Launch` a subtask of `Build`; make `Build` a subtask of `Launch`.

## Procedure

1. As `alice`, try each change through the REST API.
2. Read the parent and subtasks of `Build` and of `Launch` as `alice`.

## Expected response

- The REST API rejects both changes.
- Neither `Build` nor `Launch` has a parent or a subtask.

## Negative assertions

- No parent-and-subtask relation between `Build` and `Launch` is recorded, in either direction.

## Cleanup

Discard the test deployment.
