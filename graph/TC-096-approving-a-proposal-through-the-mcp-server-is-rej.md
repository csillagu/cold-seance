# TC-096: Approving a proposal through the MCP server is rejected

Verifies [FR-068](FR-068-let-the-mcp-server-change-the-plan-only-by-creatin.md).

## Intent

Verify that the MCP server rejects approving a proposal, which would change the plan.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, planned start 2027-03-01, 1 working day.
- An MCP client connected with `alice`'s token, and a proposal it created moving `T` to 2027-03-02.

## Procedure

1. Through the MCP server, try to approve the proposal.
2. Read `T` and the proposal through the REST API.

## Expected response

- The MCP server rejects the approval, or offers no way to make it.
- `T` still starts on 2027-03-01, and the proposal is still waiting for review.

## Negative assertions

- No change from the proposal reaches the plan.

## Cleanup

Discard the test deployment.
