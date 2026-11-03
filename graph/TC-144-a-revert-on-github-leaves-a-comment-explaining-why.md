# TC-144: A revert on GitHub leaves a comment explaining why

Verifies [FR-098](FR-098-comment-on-the-issue-for-every-revert.md).

## Intent

Verify that, for a change it reverts on GitHub, the system leaves a short comment on the issue explaining why.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` (in progress) and `B` (not started, blocked by `A`) in `Apollo`, both assigned to `tc-repo`, with issues `#1` and `#2`. `#2` has no comments.

## Procedure

1. As `tc-writer`, close `#2`.
2. Within an hour, after `#2` is reopened, read `#2`'s comments.

## Expected response

- `#2` has one new comment, posted by the tool, saying the close was reverted because `#2` is blocked by `#1`, which is not finished.

## Negative assertions

- No comment is posted on `#1`.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
