# TC-121: A change reverted on GitHub notifies the project's subscribers

Verifies [FR-086](FR-086-notify-of-each-change-reverted-on-github.md).

## Intent

Verify that, for a change the system reverts on GitHub, the people subscribed to the issue or its project are notified.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, registered in the tool by `alice` (its repository admin) and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- `bob` has the read-only role in `Apollo` and subscribes to it.
- Task `T` in `Apollo`, assigned to `tc-repo` and to `alice`, whose account is not linked to GitHub, so it has issue `#1` with no assignees.
- The trigger: `tc-writer` adds `tc-writer` as an assignee of `#1` on GitHub.

## Procedure

1. Make the trigger.
2. Within an hour, check that `#1`'s assignees are restored, then read `bob`'s in-app notifications.

## Expected response

- `bob` has a notification of the reverted change on `#1`.

## Negative assertions

- No notification about it reaches `bob` outside the app.

## Cleanup

Delete `#1` and uninstall the GitHub App from `tc-repo`; discard the test deployment.
