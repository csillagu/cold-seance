# TC-172: Creating a proposal through the MCP server is logged with the MCP channel

Verifies [FR-116](FR-116-record-every-change-in-an-audit-log.md).

## Intent

Verify that a change made through the MCP server is recorded in the audit log with the MCP server as its channel.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`; task `T`.
- `t`: the time of the change.

## Procedure

1. Through the MCP server with `alice`'s token, create a proposal moving `T` at time `t`.
2. As `alice`, read the audit log of `Apollo`.

## Expected response

- An entry records the proposal's creation, by `alice`, at `t` (to the minute), through the MCP server.

## Negative assertions

- No entry records a change to `T` itself.

## Cleanup

Discard the test deployment.
