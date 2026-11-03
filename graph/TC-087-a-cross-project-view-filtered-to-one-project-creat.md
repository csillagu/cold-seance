# TC-087: A cross-project view filtered to one project creates tasks there without asking

Verifies [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md).

## Intent

Verify that, when a cross-project view's filter allows only one project, a task created in it goes to that project without asking.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- Projects `Apollo` and `Borealis`, created by `alice`.
- A personal Kanban view of `alice`'s covering `Apollo` and `Borealis`, filtered to project `Borealis`.

## Procedure

1. As `alice`, open the view and create a task titled `Filtered work`.
2. Read `Filtered work` back through the REST API.

## Expected response

- No project question is asked.
- `Filtered work` is in `Borealis`.

## Negative assertions

- No task named `Filtered work` exists in `Apollo`.

## Cleanup

Discard the test deployment.
