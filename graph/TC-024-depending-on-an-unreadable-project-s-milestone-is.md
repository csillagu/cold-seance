# TC-024: Depending on an unreadable project's milestone is rejected

Verifies [FR-016](FR-016-require-read-access-to-depend-on-another-project-s.md).

## Intent

Verify that the system rejects a dependency on another project's milestone from someone who cannot read that project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has no role, directly or through a group.
- Milestone `M` in `Borealis`; its identifier, taken from `bob`'s view of it.
- Task `T` in `Apollo`, unassigned, unscheduled.

## Procedure

1. As `alice`, try through the REST API to make `T` blocked by `M`, giving `M`'s identifier.
2. Read `T`'s blocked-by relations as `alice`.

## Expected response

- The REST API reports a rejection.
- `T` has no blocked-by relations.

## Negative assertions

- No dependency on `M` is recorded in `Apollo`.
- The response reveals nothing about `M` beyond what FR-017 allows.

## Cleanup

Discard the test deployment.
