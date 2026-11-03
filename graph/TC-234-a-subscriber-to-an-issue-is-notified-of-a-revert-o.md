# TC-234: A subscriber to an issue is notified of a revert on it within an hour

Verifies [FR-162](FR-162-send-subscribers-the-notifications-for-what-they-s.md).

## Intent

Verify that a subscriber is sent, within an hour, the notifications about the issue they subscribed to.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, where `carol` has the read-only role. GitHub user `tc-writer` has write access to `tc-repo`.
- Tasks `A` (in progress) and `B` (not started, blocked by `A`) in `Apollo`, both assigned to `tc-repo`, with issues `#1` and `#2`. `carol` subscribes to `#2` and not to `Apollo`.

## Procedure

1. As `tc-writer`, close `#2` at time `t`.
2. At `t` + 60 minutes, read `carol`'s in-app notifications.

## Expected response

- `carol` has a notification that the close of `#2` was reverted.

## Negative assertions

- The notification did not arrive later than `t` + 60 minutes.

## Cleanup

Delete `#1` and `#2` and uninstall the GitHub App; discard the test deployment.
