# TC-128: Assigned people are mirrored to GitHub as assignees

Verifies [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md).

## Intent

Verify that the system mirrors a task's assigned people to its issue's GitHub assignees within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, linked to GitHub user `tc-alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, where `tc-alice` can be assigned; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Task `T` in `Apollo`, assigned to `tc-repo`, so it has issue `#1`, with no assigned people.
- The change: assign `alice` to `T`.

## Procedure

1. As `alice`, make the change.
2. Within an hour, read `#1`'s assignees on GitHub.

## Expected response

- `#1`'s assignees are exactly [`tc-alice`].

## Negative assertions

- No other GitHub user is assigned to `#1`.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
