# TC-072: A task's dates shown on the Gantt can be edited on the Gantt

Verifies [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md).

## Intent

Verify that a user can edit, in the Gantt view, the dates and dependencies the Gantt shows, within what their role allows.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice` (admin).
- Tasks `A` (2027-03-01, 1 working day) and `B` (2027-03-08, 1 working day) in `Apollo`, with no relation.

## Procedure

1. As `alice`, open the Gantt of `Apollo`.
2. Move `A` to start on 2027-03-02.
3. Draw a dependency making `B` blocked by `A`.
4. Read `A` and `B` back through the REST API.

## Expected response

- `A` starts on 2027-03-02.
- `B` is blocked by `A`.

## Negative assertions

- Neither change required leaving the Gantt.

## Cleanup

Discard the test deployment.
