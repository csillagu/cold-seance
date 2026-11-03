# TC-219: An assignment that overloads the new assignee does not move the task

Verifies [FR-148](FR-148-never-move-a-task-because-its-assigned-people-beca.md).

## Intent

Verify that, when someone is assigned to a planned task and that leaves the task's assigned people unable to do it in its time, the task is not moved.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, capacity 100%; project `Apollo` created by `alice`, where `bob` has the read-only role.
- In `Apollo`: task `X`, assigned to `bob`, AI share 0%, 2027-03-01 to 2027-03-05; task `T`, unassigned, AI share 0%, 2027-03-01 to 2027-03-03.
- The change: assign `bob` to `T`.

## Procedure

1. As `alice`, make the change.
2. Read `T` and `X`.

## Expected response

- The change is accepted.
- `T` still runs 2027-03-01 to 2027-03-03, and `X` 2027-03-01 to 2027-03-05.

## Negative assertions

- `bob` is not removed from either task.

## Cleanup

Discard the test deployment.
