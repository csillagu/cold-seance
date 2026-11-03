# TC-235: A subscriber to one issue gets no notification about another

Verifies [FR-162](FR-162-send-subscribers-the-notifications-for-what-they-s.md).

## Intent

Verify that a subscriber is sent only the notifications about what they subscribed to.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, where `carol` has the read-only role. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` (in progress), `B` (not started, blocked by `A`) and `C` in `Apollo`, all assigned to `tc-repo`, with issues `#1`, `#2` and `#3`. `carol` subscribes to `#3` only.

## Procedure

1. As `tc-writer`, close `#2`.
2. One hour later, after `#2` is reopened, read `carol`'s in-app notifications.

## Expected response

- `carol` has no notification about `#2`.

## Negative assertions

- `carol`'s subscription to `#3` is unchanged.

## Cleanup

Delete the issues and uninstall the GitHub App; discard the test deployment.
