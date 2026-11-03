# TC-080: A personal view covers only what its owner can read

Verifies [FR-056](FR-056-limit-which-projects-a-saved-view-can-cover.md).

## Intent

Verify that a personal saved view can cover several projects its owner can read, and none they cannot.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-only role; project `Ceres` created by `bob`, where `alice` has no role.
- Attempt 1: a personal Kanban view of `alice`'s covering `Apollo` and `Borealis`.
- Attempt 2: a personal Kanban view of `alice`'s covering `Apollo` and `Ceres`.

## Procedure

1. As `alice`, try both saves through the REST API.

## Expected response

- Attempt 1 succeeds.
- Attempt 2 is rejected.

## Negative assertions

- No view of `alice`'s shows any task of `Ceres`.

## Cleanup

Discard the test deployment.
