# TC-090: A named baseline keeps a snapshot of every task's planned dates

Verifies [FR-064](FR-064-save-a-named-baseline-of-a-project-s-planned-dates.md).

## Intent

Verify that the system saves, under a name, a snapshot of every task's planned start and finish in a project.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- Tasks in `Apollo`: `A` (2027-03-01, 3 working days) and `B` (2027-03-08, 2 working days).
- The baseline name `v1 approved`.

## Procedure

1. As `alice`, save a baseline of `Apollo` named `v1 approved`.
2. Move `A` to start on 2027-03-15.
3. Read baseline `v1 approved`.

## Expected response

- The baseline holds `A`: 2027-03-01 to 2027-03-03 and `B`: 2027-03-08 to 2027-03-09.

## Negative assertions

- The baseline does not follow the move of `A` made at step 2.

## Cleanup

Discard the test deployment.
