# TC-004: An unscheduled task appears on the Kanban

Verifies [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md).

## Intent

Verify that the Kanban view shows a project's unscheduled tasks.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `Triage backlog` (no planned dates) and scheduled task `Write guide` (planned start 2027-03-01, duration 2 working days).

## Procedure

1. As `alice`, open the Kanban view of `Apollo` in the browser.

## Expected response

- A card for `Triage backlog` is shown on the Kanban.
- A card for `Write guide` is shown too.

## Negative assertions

- `Triage backlog` is not hidden behind a filter or a separate page.

## Cleanup

Discard the test deployment.
