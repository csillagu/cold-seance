# TC-143: A blocked-by change made on GitHub is undone

Verifies [FR-097](FR-097-undo-planning-edits-made-on-github.md).

## Intent

Verify that the system does not accept a blocked-by change made on GitHub, and restores its own state within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` and `B` in `Apollo`, `B` blocked by `A`, both assigned to `tc-repo`, with issues `#1` and `#2` (`#2` blocked by `#1`).

## Procedure

1. As `tc-writer`, remove the blocked-by relation between `#2` and `#1`.
2. Within an hour, read `#2`'s blocked-by relations and `B`'s in the tool.

## Expected response

- `#2` is blocked by `#1` again.
- `B` is still blocked by `A`.

## Negative assertions

- `B`'s dates are unchanged.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
