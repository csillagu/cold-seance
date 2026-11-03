# TC-141: An assignee change made on GitHub is undone

Verifies [FR-097](FR-097-undo-planning-edits-made-on-github.md).

## Intent

Verify that the system does not accept a change to an issue's assignees made on GitHub, and restores its own state within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, linked to GitHub user `tc-alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, assigned to `alice` and to `tc-repo`, so its issue `#1` has assignees [`tc-alice`].

## Procedure

1. As `tc-writer`, set `#1`'s assignees to [`tc-writer`].
2. Within an hour, read `#1`'s assignees and `T`'s assigned people.

## Expected response

- `#1`'s assignees are [`tc-alice`] again.
- `T`'s assigned people are [`alice`].

## Negative assertions

- No person is added to or removed from `T` in the tool.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
