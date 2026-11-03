# TC-070: The baseline variance view allows no edits

Verifies [FR-052](FR-052-keep-the-baseline-variance-view-read-only.md).

## Intent

Verify that the baseline variance view allows no edits.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice` (so she may edit its plan elsewhere).
- Task `T` in `Apollo`, planned start 2027-03-01, 3 working days; baseline `v1` saved after it.

## Procedure

1. As `alice`, open the baseline variance view of `Apollo` with `v1` selected.
2. Try to change `T`'s title, its planned dates and `v1`'s dates in the view: by clicking, double-clicking and dragging each shown value.

## Expected response

- No value in the view can be edited.

## Negative assertions

- After step 2, `T` and `v1` read back through the REST API exactly as before.

## Cleanup

Discard the test deployment.
