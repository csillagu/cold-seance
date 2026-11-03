# TC-225: A project keeps several named baselines

Verifies [FR-153](FR-153-keep-several-baselines-per-project.md).

## Intent

Verify that the system keeps several baselines per project, each under its own name.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, 2027-03-01, 1 working day.

## Procedure

1. As `alice`, save baseline `v1 approved`.
2. Move `T` to 2027-03-08 and save baseline `v2 after re-plan`.
3. List the baselines of `Apollo` and read each.

## Expected response

- Both baselines are listed under their names.
- `v1 approved` holds `T` on 2027-03-01 and `v2 after re-plan` holds `T` on 2027-03-08.

## Negative assertions

- Saving `v2 after re-plan` did not replace or change `v1 approved`.

## Cleanup

Discard the test deployment.
