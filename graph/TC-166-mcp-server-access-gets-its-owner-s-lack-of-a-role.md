# TC-166: MCP server access gets its owner's lack of a role

Verifies [FR-113](FR-113-apply-the-same-roles-to-api-tokens-and-mcp-server.md).

## Intent

Verify that MCP server access is held to the same project roles as its owner in the UI.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `dave`; project `Apollo` created by `alice`, where `dave` has no role.
- An access token created by `dave`, used by an MCP client; task `T` in `Apollo`.

## Procedure

1. Through the MCP server with `dave`'s token, try to read `Apollo`'s plan.
2. Through the MCP server with `dave`'s token, try to create a proposal moving `T`.

## Expected response

- Both are refused.

## Negative assertions

- No data of `Apollo` is returned, and no proposal is created.

## Cleanup

Discard the test deployment.
