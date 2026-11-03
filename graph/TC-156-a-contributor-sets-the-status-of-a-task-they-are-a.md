# TC-156: A contributor sets the status of a task they are assigned to

Verifies [FR-107](FR-107-let-a-contributor-set-only-the-status-of-tasks-ass.md).

## Intent

Verify that a person with the contributor role can mark a task they are assigned to as in progress, on hold and finished.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`; project `Apollo` created by `alice`, where `carol` has the contributor role.
- Task `T` in `Apollo`, assigned to `carol`, not started, no relations, no subtasks.

## Procedure

1. As `carol`, set `T` to in progress, then on hold, then in progress again, then finished, reading `T` after each step.

## Expected response

- Each change is accepted and `T` shows each status in turn, ending done.

## Negative assertions

- No field of `T` other than its status and actual dates changes.

## Cleanup

Discard the test deployment.
