# TC-152: Seeding imports a closed issue as done with its closing date

Verifies [FR-104](FR-104-import-closed-issues-as-done-tasks-with-their-actu.md).

## Intent

Verify that seeding imports each closed issue as a done task, with its actual finish taken from the GitHub Projects closing date.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and a GitHub Project; one closed issue, `#1 Old work`, whose closing date in the GitHub Project is 2026-09-15.
- `tc-seed` registered in the tool by `alice`; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed`.
2. Read the tasks of `Apollo`.

## Expected response

- `Apollo` has one task, linked to `#1`, done, with actual finish 2026-09-15.

## Negative assertions

- `#1` is not reopened.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
