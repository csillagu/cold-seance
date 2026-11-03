# TC-007: An unscheduled task appears in the baseline variance view

Verifies [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md).

## Intent

Verify that the baseline variance view shows unscheduled tasks.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: scheduled task `Write guide` (planned start 2027-03-01, duration 2 working days); a baseline `v1` saved after it.
- Then unscheduled task `Triage backlog` (no planned dates) added to `Apollo`.

## Procedure

1. As `alice`, open the baseline variance view of `Apollo` in the browser with baseline `v1` selected.

## Expected response

- `Triage backlog` is shown in the view. Not stated: how its missing dates are displayed; this test passes on its presence.
- `Write guide` is shown too.

## Negative assertions

- No dates are given to `Triage backlog` by showing it.

## Cleanup

Discard the test deployment.
