# TC-127: A blocked-by relation is mirrored to GitHub

Verifies [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md).

## Intent

Verify that the system mirrors a blocked-by relation to GitHub within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Tasks `A` and `B` in `Apollo`, both assigned to `tc-repo`, so they have issues `#1` and `#2`, with no relation.
- The change: make `B` blocked by `A`.

## Procedure

1. As `alice`, make the change.
2. Within an hour, read `#2`'s blocked-by relations on GitHub.

## Expected response

- `#2` is blocked by `#1`.

## Negative assertions

- `#1` is not marked as blocked by `#2`.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
