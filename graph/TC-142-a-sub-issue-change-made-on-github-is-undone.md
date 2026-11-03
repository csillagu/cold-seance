# TC-142: A sub-issue change made on GitHub is undone

Verifies [FR-097](FR-097-undo-planning-edits-made-on-github.md).

## Intent

Verify that the system does not accept a sub-issue change made on GitHub, and restores its own state within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` and `B` in `Apollo` with no relation, both assigned to `tc-repo`, with issues `#1` and `#2`.

## Procedure

1. As `tc-writer`, make `#2` a sub-issue of `#1`.
2. Within an hour, read `#1`'s sub-issues and `B`'s parent in the tool.

## Expected response

- `#1` has no sub-issues.
- `B` has no parent in the tool.

## Negative assertions

- `A`'s and `B`'s dates are unchanged.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
