# TC-238: Seeding skips an issue blocked by one outside the chosen repositories

Verifies [FR-163](FR-163-skip-issues-that-seeding-cannot-bring-in-cleanly.md).

## Intent

Verify that seeding skips an issue blocked by an issue outside the chosen repositories.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- GitHub test repositories `tc-seed` and `tc-elsewhere`, both with the tool's GitHub App installed. `tc-seed` has open issues `#1` and `#2`; `#2` is blocked by an issue in `tc-elsewhere`.
- `tc-seed` registered in the tool by `alice`; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed` only.
2. List the tasks of `Apollo`.

## Expected response

- The seeding completes; `Apollo` has a task for `#1` only.

## Negative assertions

- `Apollo` has no task for `#2` and none for the blocking issue in `tc-elsewhere`.

## Cleanup

Uninstall the GitHub App from both repositories; discard the test deployment.
