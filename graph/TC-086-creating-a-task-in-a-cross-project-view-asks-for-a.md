# TC-086: Creating a task in a cross-project view asks for a writable project

Verifies [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md).

## Intent

Verify that creating a task in a view covering several projects asks which project it goes in, offering only the projects the viewer can write to.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-write role; project `Ceres` created by `bob`, where `alice` has the read-only role.
- A personal Kanban view of `alice`'s covering `Apollo`, `Borealis` and `Ceres`, with no filter.

## Procedure

1. As `alice`, open the view and start creating a task titled `New work`.
2. Note the projects offered, choose `Borealis` and save.
3. Read `New work` back through the REST API.

## Expected response

- At step 2 the system asks for the project and offers exactly `Apollo` and `Borealis`.
- `New work` is in `Borealis`.

## Negative assertions

- `Ceres` is not offered.

## Cleanup

Discard the test deployment.
