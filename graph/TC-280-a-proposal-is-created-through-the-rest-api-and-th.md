# TC-280: A proposal is created through the REST API and through the MCP server

Verifies [FR-204](FR-204-accept-a-new-proposal-through-the-rest-api-and-the.md).

## Intent

Verify that the system accepts a new proposal through the REST API and through the MCP server, and keeps with each the channel it came through.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- The proposal: one group, moving `A` to start on 2027-03-08.

## Procedure

1. Through the REST API with `alice`'s token, create the proposal.
2. Through the MCP server with `alice`'s token, create the proposal.
3. As `alice`, list `Apollo`'s proposals and read `A`.

## Expected response

- At steps 1 and 2, each request reports the proposal created.
- At step 3, `Apollo` has exactly two proposals, the first made through the REST API and the second through the MCP server, each holding the one move of `A`.

## Negative assertions

- `A` still starts on 2027-03-01: creating a proposal moves nothing.

## Cleanup

Discard the test deployment.
