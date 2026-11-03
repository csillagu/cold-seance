# TC-005: An unscheduled task appears on the Gantt

Verifies [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md).

## Intent

Verify that the Gantt view shows a project's unscheduled tasks.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `Triage backlog` (no planned dates) and scheduled task `Write guide` (planned start 2027-03-01, duration 2 working days).

## Procedure

1. As `alice`, open the Gantt view of `Apollo` in the browser.

## Expected response

- `Triage backlog` is shown on the Gantt.
- `Write guide` is shown as a bar from 2027-03-01 to 2027-03-02.

## Negative assertions

- `Triage backlog` is not hidden behind a filter or a separate page.
- No dates are given to `Triage backlog` by showing it.

## Cleanup

Discard the test deployment.
