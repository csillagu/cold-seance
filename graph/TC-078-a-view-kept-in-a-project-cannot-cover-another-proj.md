# TC-078: A view kept in a project cannot cover another project

Verifies [FR-056](FR-056-limit-which-projects-a-saved-view-can-cover.md).

## Intent

Verify that a saved view kept in a project is limited to that project.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- Projects `Apollo` and `Borealis`, both created by `alice`.
- The attempt: save a Kanban view `Both`, kept in project `Apollo`, covering `Apollo` and `Borealis`.

## Procedure

1. As `alice`, try to save the view through the REST API.
2. List the saved views of `Apollo`.

## Expected response

- The save is rejected, or no option lets the view cover `Borealis`. Not stated: which of the two; either passes.

## Negative assertions

- No view kept in `Apollo` shows tasks of `Borealis`.

## Cleanup

Discard the test deployment.
