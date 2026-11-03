# TC-239: An approved proposal's change is logged with both the MCP and the UI channel

Verifies [FR-164](FR-164-log-both-channels-for-a-change-from-an-approved-ai.md).

## Intent

Verify that, for each change an approved AI proposal applies, the audit log records both channels: the MCP server and the UI.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08.

## Procedure

1. As `bob`, approve the proposal in the browser.
2. As `alice`, read the audit log of `Apollo`.

## Expected response

- The entry for the move of `A` records both the MCP server and the UI as its channels.

## Negative assertions

- It does not record the REST API or GitHub.

## Cleanup

Discard the test deployment.
