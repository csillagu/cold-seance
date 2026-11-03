# TC-105: A read-write reviewer rejects a proposal

Verifies [FR-075](FR-075-let-a-reviewer-reject-a-proposal.md).

## Intent

Verify that a person with the read-write role can reject a proposal, and that nothing in it reaches the plan.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08.

## Procedure

1. As `bob`, reject the proposal in the browser.
2. Read the proposal and `A` through the REST API.

## Expected response

- The proposal is rejected and is no longer waiting for review.

## Negative assertions

- `A` still starts 2027-03-01.
- The proposal can no longer be approved.

## Cleanup

Discard the test deployment.
