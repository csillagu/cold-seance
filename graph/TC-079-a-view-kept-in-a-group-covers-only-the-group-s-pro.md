# TC-079: A view kept in a group covers only the group's projects

Verifies [FR-056](FR-056-limit-which-projects-a-saved-view-can-cover.md).

## Intent

Verify that a saved view kept in a group can cover several of the group's projects, and none outside the group.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- Group `Platform` created by `alice`; projects `Apollo` and `Borealis` created by `alice` and added to `Platform`; project `Ceres` created by `alice`, not in `Platform`.
- Attempt 1: save a Gantt view `Platform plan`, kept in `Platform`, covering `Apollo` and `Borealis`.
- Attempt 2: save a Gantt view `Too wide`, kept in `Platform`, covering `Apollo` and `Ceres`.

## Procedure

1. As `alice`, try both saves through the REST API.
2. List the saved views of `Platform`.

## Expected response

- Attempt 1 succeeds and `Platform plan` covers `Apollo` and `Borealis`.
- Attempt 2 is rejected.

## Negative assertions

- No view kept in `Platform` covers `Ceres`.

## Cleanup

Discard the test deployment.
