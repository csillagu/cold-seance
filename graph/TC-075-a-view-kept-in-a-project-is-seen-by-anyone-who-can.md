# TC-075: A view kept in a project is seen by anyone who can read the project

Verifies [FR-055](FR-055-keep-a-saved-view-in-a-project-a-group-or-personal.md).

## Intent

Verify that a saved view kept in a project is seen by everyone who can read the project, and by no one else.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `dave`.
- Project `Apollo` created by `alice`; `bob` has the read-only role; `dave` has no role, directly or through a group.
- A Kanban view `Apollo board`, kept in project `Apollo`, saved by `alice`.

## Procedure

1. As `bob`, list the saved views of `Apollo` and open `Apollo board`.
2. As `dave`, list the saved views they can see.

## Expected response

- `bob` sees and can open `Apollo board`.

## Negative assertions

- `Apollo board` is not among `dave`'s views.

## Cleanup

Discard the test deployment.
