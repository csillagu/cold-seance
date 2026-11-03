# TC-253: A project's request notifies every repository admin in the app

Verifies [FR-173](FR-173-notify-a-repository-s-admins-in-the-app-of-a-proje.md).

## Intent

Verify that, when a project's admin asks to add a repository to the project, the repository's admins are notified in the app.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `bob`, with `carol` also its admin.
- Project `Apollo` created by `alice`.

## Procedure

1. As `alice`, ask to add `tc-repo` to `Apollo`.
2. Read the in-app notifications of `bob` and `carol`.

## Expected response

- Both have a notification of `Apollo`'s request for `tc-repo`.

## Negative assertions

- `alice` gets no such notification.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
