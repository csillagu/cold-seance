# TC-282: A proposal made through the UI is refused

Verifies [FR-206](FR-206-refuse-a-new-proposal-made-through-the-ui.md).

## Intent

Verify that the system refuses a new proposal made through the UI, by a person who could create one through the REST API.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- The proposal: one group, moving `A` to start on 2027-03-08.

## Procedure

1. Sign in to the browser as `alice`. With that sign-in, not the access token, send the request that creates the proposal.
2. Through the REST API with `alice`'s token, list `Apollo`'s proposals and read `A`.

## Expected response

- At step 1, the request is reported as refused, saying a proposal is created through the REST API or the MCP server.
- At step 2, `Apollo` has no proposals, and `A` still starts on 2027-03-01.

## Negative assertions

- No proposal is stored, and no proposal creation is written to the audit log.

## Cleanup

Discard the test deployment.
