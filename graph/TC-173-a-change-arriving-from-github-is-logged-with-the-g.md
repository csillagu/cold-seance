# TC-173: A change arriving from GitHub is logged with the GitHub channel

Verifies [FR-116](FR-116-record-every-change-in-an-audit-log.md).

## Intent

Verify that a change arriving from GitHub is recorded in the audit log with GitHub as its channel.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, in progress, no relations, assigned to `tc-repo`, with issue `#1`.

## Procedure

1. As `tc-writer`, close `#1` at time `t`.
2. Within an hour, after `T` is done, read the audit log of `Apollo` as `alice`.

## Expected response

- An entry records `T` being finished, through GitHub, with a time no earlier than `t`, and names who made it. Not stated: how a GitHub user with no account in the tool is named; this test passes if the entry identifies `tc-writer`.

## Negative assertions

- The entry does not give the UI, the REST API or the MCP server as its channel.

## Cleanup

Delete `#1` and uninstall the GitHub App; discard the test deployment.
