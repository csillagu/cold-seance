# TC-126: A subtask relation is mirrored to GitHub as a sub-issue

Verifies [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md).

## Intent

Verify that the system mirrors a subtask relation to GitHub as a sub-issue relation within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Tasks `Parent` and `Child` in `Apollo`, both assigned to `tc-repo`, so they have issues `#1` and `#2`, with no relation.
- The change: make `Child` a subtask of `Parent`.

## Procedure

1. As `alice`, make the change.
2. Within an hour, read `#1`'s sub-issues on GitHub.

## Expected response

- `#2` is a sub-issue of `#1`.

## Negative assertions

- No other sub-issue relation is added on GitHub.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
