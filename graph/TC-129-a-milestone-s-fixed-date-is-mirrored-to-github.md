# TC-129: A milestone's fixed date is mirrored to GitHub

Verifies [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md).

## Intent

Verify that the system mirrors a milestone's fixed date to GitHub within an hour.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Milestone `M` in `Apollo`, assigned to `tc-repo`, so it has issue `#1`, not yet pinned.
- The change: pin `M` to the fixed date 2027-03-12.

## Procedure

1. As `alice`, make the change.
2. Within an hour, look at `#1` on GitHub.

## Expected response

- `#1` carries the fixed date 2027-03-12. Not stated: where on GitHub the date is held; this test passes if the date can be read from the issue or its GitHub Project item.

## Negative assertions

- No other date is shown on `#1` as its fixed date.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
