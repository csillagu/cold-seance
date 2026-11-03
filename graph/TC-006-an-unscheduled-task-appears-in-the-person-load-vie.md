# TC-006: An unscheduled task appears in the person load view

Verifies [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md).

## Intent

Verify that the person load view shows unscheduled tasks.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `Triage backlog` (no planned dates), assigned to `alice`.

## Procedure

1. As `alice`, open the person load view covering `Apollo` in the browser.

## Expected response

- `Triage backlog` is shown in the person load view. Not stated: where in the view it appears or how it is drawn, since it has no days to carry load; this test passes on its presence.

## Negative assertions

- Showing `Triage backlog` adds no load to `alice` on any day.

## Cleanup

Discard the test deployment.
