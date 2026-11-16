# TC-286: A task created in the UI with a duration of 0 is a milestone

Verifies [FR-212](FR-212-make-a-new-task-with-a-duration-of-0-a-milestone.md).

## Intent

Verify that a task created through either new-task form with a duration of 0 is created as a milestone, fixed to its planned start or floating without one, that the fields a milestone cannot have are not offered, and that an existing task cannot be given a duration of 0.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`, with task `Write guide` (2027-03-01, 3 working days).
- Task `Launch`: duration 0, planned start 2027-03-12.
- Task `Docs ready`: duration 0, no planned start.

## Procedure

1. As `alice`, open `Apollo`'s New task page, type `Launch`'s title and a duration of 0, and look at the fields offered. Type its planned start and create it.
2. As `alice`, open the new-task dialog on `Apollo`'s Gantt, type `Docs ready`'s title and a duration of 0, and create it.
3. Read `Launch` and `Docs ready` back through the REST API.
4. As `alice`, open `Write guide`'s page, set its duration to 0 and save.

## Expected response

- At step 1, with the duration at 0, the form offers no effort, AI share, planned finish or assignees.
- `Launch` reads back as a fixed-date milestone pinned to 2027-03-12, and `Docs ready` as a floating milestone.
- At step 4, the change is refused and `Write guide` keeps its duration of 3.

## Negative assertions

- Neither `Launch` nor `Docs ready` reads back as a normal task or with a duration.
- `Write guide` does not become a milestone.

## Cleanup

Discard the test deployment.
