# TC-236: Seeding skips an issue that is already a task in another project

Verifies [FR-163](FR-163-skip-issues-that-seeding-cannot-bring-in-cleanly.md).

## Intent

Verify that seeding skips an issue that is already a task in another project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and open issues `#1` and `#2`; registered in the tool by `alice`.
- Project `Borealis` created by `bob`, already holding a task linked to `#1`. Project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed`.
2. List the tasks of `Apollo` and of `Borealis`.

## Expected response

- The seeding completes; `Apollo` has a task for `#2` only.

## Negative assertions

- `Apollo` has no task for `#1`, and `Borealis`'s task for `#1` is unchanged.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
