# TC-094: The MCP server returns the plan

Verifies [FR-067](FR-067-let-the-mcp-server-read-the-plan.md).

## Intent

Verify that the MCP server gives read access to the plan.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, with an access token; project `Apollo` created by `alice`.
- Tasks in `Apollo`: `A` (2027-03-01, 3 working days) and `B`, blocked by `A`, 2 working days.
- An MCP client connected to the tool's MCP server with `alice`'s token.

## Procedure

1. Through the MCP server, read the plan of `Apollo`.
2. Read the same plan through the REST API as `alice`.

## Expected response

- The MCP read returns `A` (2027-03-01 to 2027-03-03), `B` (2027-03-04 to 2027-03-05) and the relation `B` blocked by `A`.
- It matches the REST API's answer.

## Negative assertions

- The read changes nothing in `Apollo`.

## Cleanup

Discard the test deployment.
