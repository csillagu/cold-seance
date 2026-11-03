# TC-197: A person subscribes to an issue

Verifies [FR-133](FR-133-let-people-subscribe-to-issues-and-projects.md).

## Intent

Verify that people can subscribe to an issue.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, where `carol` has the read-only role.
- Task `T` in `Apollo`, assigned to `tc-repo`, with issue `#1`.

## Procedure

1. As `carol`, subscribe to `#1`.
2. Read `carol`'s subscriptions.

## Expected response

- `carol` is subscribed to `#1`.

## Negative assertions

- `carol` is not subscribed to `Apollo` as a whole.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
