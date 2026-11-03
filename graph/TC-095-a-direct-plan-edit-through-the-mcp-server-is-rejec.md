# TC-095: A direct plan edit through the MCP server is rejected

Verifies [FR-068](FR-068-let-the-mcp-server-change-the-plan-only-by-creatin.md).

## Intent

Verify that the MCP server rejects a direct change to the plan.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice` (so `alice` has every role's rights there).
- Task `T` in `Apollo`, planned start 2027-03-01, 1 working day.
- An MCP client connected with `alice`'s token.

## Procedure

1. Through the MCP server, try to set `T`'s planned start to 2027-03-02 directly, without a proposal, by any means the MCP server offers.
2. Read `T` through the REST API.

## Expected response

- The MCP server rejects the change, or offers no way to make it.
- `T` still starts on 2027-03-01.

## Negative assertions

- No proposal is created by the attempt.
- The audit log records no change to `T`.

## Cleanup

Discard the test deployment.
