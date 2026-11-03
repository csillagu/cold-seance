# TC-169: A cycle is rejected alike through the UI, the REST API and the MCP server

Verifies [FR-115](FR-115-apply-the-same-rules-to-the-ui-the-rest-api-and-th.md).

## Intent

Verify that the same validation rule applies to a change whichever channel it comes through.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- In `Apollo`: tasks `A` and `B`, `A` blocked by `B`.
- The change: make `B` blocked by `A`.

## Procedure

1. As `alice`, try the change in the UI.
2. Try it through the REST API.
3. Try it through the MCP server as a proposal; if the proposal is accepted, try to approve it in the UI.
4. Read `B`'s blocked-by relations.

## Expected response

- The change is rejected through each channel (for the MCP server, at proposal creation or at approval).

## Negative assertions

- `B` is never blocked by `A`.

## Cleanup

Discard the test deployment.
