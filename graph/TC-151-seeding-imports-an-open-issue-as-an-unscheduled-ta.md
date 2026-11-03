# TC-151: Seeding imports an open issue as an unscheduled task

Verifies [FR-103](FR-103-import-open-issues-as-unscheduled-tasks.md).

## Intent

Verify that seeding imports each open issue as an unscheduled task.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and one open issue, `#1 Open work`, with no relations and no assignees.
- `tc-seed` registered in the tool by `alice`; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, seed `Apollo` from `tc-seed`.
2. Read the tasks of `Apollo`.

## Expected response

- `Apollo` has one task, linked to `#1`, with no planned dates.

## Negative assertions

- The task is not done, cancelled or in progress.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
