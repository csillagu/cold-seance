# TC-274: People on a task who cannot read its project are marked

Verifies [FR-199](FR-199-mark-the-people-on-a-task-who-cannot-read-its-proj.md).

## Intent

Verify that the UI marks each person in a task's eligibility expression and assignment who cannot read the task's project, and no one else.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- Project `Apollo` created by `alice`; `bob` and `carol` have the read-only role in it.
- Task `T` in `Apollo`, eligibility `alice OR bob OR carol`, assigned people [`bob`, `carol`].
- The change: `alice` removes `bob`'s role in `Apollo`.

## Procedure

1. As `alice`, open `T` in the browser and look at its eligibility and assigned people.
2. Make the change.
3. As `alice`, open `T` in the browser again.

## Expected response

- At step 1 no one in `T`'s eligibility or assignment is marked.
- At step 3 `bob` is marked as not able to read `Apollo`, both in the eligibility and in the assigned people; `alice` and `carol` are not marked.

## Negative assertions

- `bob` is not removed from `T`'s eligibility or assignment.

## Cleanup

Discard the test deployment.
