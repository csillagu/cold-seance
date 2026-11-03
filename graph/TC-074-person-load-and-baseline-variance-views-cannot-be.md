# TC-074: Person load and baseline variance views cannot be saved

Verifies [FR-054](FR-054-let-users-save-named-kanban-and-gantt-views.md).

## Intent

Verify that the person load and baseline variance view kinds have no saved views.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`; a baseline `v1` of `Apollo`.

## Procedure

1. As `alice`, open the person load view and look for a way to save it as a named view.
2. Do the same in the baseline variance view.
3. Through the REST API, try to save a view of the person load kind named `Load view`.

## Expected response

- Neither view offers to be saved.
- The REST API rejects step 3.

## Negative assertions

- `alice`'s saved views list contains no view named `Load view` and no view of either kind.

## Cleanup

Discard the test deployment.
