# TC-064: The four view kinds are available for a project

Verifies [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md).

## Intent

Verify that the system provides the four view kinds: Kanban, Gantt, person load and baseline variance.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, planned start 2027-03-01, duration 2 working days; baseline `v1` of `Apollo` saved after it.

## Procedure

1. As `alice`, open in the browser, one after the other, the Kanban, the Gantt, the person load view and the baseline variance view of `Apollo`.

## Expected response

- Each of the four views opens and shows `T`.

## Negative assertions

- Opening a view changes no task.

## Cleanup

Discard the test deployment.
