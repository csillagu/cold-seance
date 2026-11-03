# TC-077: A personal view is seen by its owner only

Verifies [FR-055](FR-055-keep-a-saved-view-in-a-project-a-group-or-personal.md).

## Intent

Verify that a saved view kept personally is seen only by its owner.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; `bob` has the read-write role in it.
- A Gantt view `My plan`, covering `Apollo`, kept personally by `alice`.

## Procedure

1. As `alice`, list their saved views.
2. As `bob`, list the saved views they can see, in `Apollo` and personally.

## Expected response

- `My plan` is in `alice`'s list.

## Negative assertions

- `My plan` is not in `bob`'s list.

## Cleanup

Discard the test deployment.
