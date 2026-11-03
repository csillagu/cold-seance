# TC-130: A person without a linked GitHub account is left off the issue's assignees

Verifies [FR-090](FR-090-create-issues-without-a-github-assignee-for-people.md).

## Intent

Verify that, when a task is assigned to people without a GitHub account, they are left off the issue's GitHub assignees.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, linked to GitHub user `tc-alice`, and `bob`, with no linked GitHub account.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, where `tc-alice` can be assigned; registered in the tool by `alice` and added to project `Apollo`, created by `alice`, where `bob` has the read-only role.
- Task `T` in `Apollo`, assigned to `tc-repo`, so it has issue `#1`.
- The change: assign `alice` and `bob` to `T`.

## Procedure

1. As `alice`, make the change.
2. Within an hour, read `#1`'s assignees on GitHub, and `T`'s assigned people in the tool.

## Expected response

- `#1`'s assignees are exactly [`tc-alice`].
- `T`'s assigned people in the tool are [`alice`, `bob`].

## Negative assertions

- The change is not rejected, and `bob` is not removed from `T` in the tool.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
