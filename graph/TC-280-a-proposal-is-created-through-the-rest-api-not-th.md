# TC-280: A proposal is created through the REST API and the MCP server, not the UI

Verifies [FR-204](FR-204-accept-a-new-proposal-through-the-rest-api-and-the.md).

## Intent

Verify that the system accepts a new proposal through the REST API and through the MCP server, and refuses one through the UI.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- The proposal: move `A` to start on 2027-03-08.

## Procedure

1. Through the REST API with `alice`'s token, create the proposal.
2. Through the MCP server with `alice`'s token, create the proposal.
3. Signed in to the browser as `alice`, try to create the proposal through the UI's own requests.
4. As `alice`, list `Apollo`'s proposals and read `A`.

## Expected response

- At steps 1 and 2 the proposal is created; at step 3 it is refused.
- At step 4 there are exactly two proposals, made through the REST API and through the MCP server, and `A` still starts on 2027-03-01.

## Negative assertions

- No proposal is stored from step 3.

## Cleanup

Discard the test deployment.
