# TC-237: Seeding skips an issue an earlier import already brought in

Verifies [FR-163](FR-163-skip-issues-that-seeding-cannot-bring-in-cleanly.md).

## Intent

Verify that seeding skips an issue already brought in by an earlier import of the same repository.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and open issue `#1`; registered in the tool by `alice`; project `Apollo` created by `alice`, seeded once from `tc-seed`, so it holds a task for `#1`.
- Then open issue `#2` is added to `tc-seed`.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed` again.
2. List the tasks of `Apollo`.

## Expected response

- `Apollo` has exactly one task for `#1` and one for `#2`.

## Negative assertions

- No second task for `#1` exists.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
