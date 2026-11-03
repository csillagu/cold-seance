# TC-115: A proposal untouched for 24 hours expires

Verifies [FR-081](FR-081-expire-a-proposal-untouched-for-24-hours.md).

## Intent

Verify that a proposal that nobody, AI or person, has edited for 24 hours expires.

## Inputs

- A test deployment of the tool whose clock the tester can set forward; first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server at time `t0`, moving `A` to 2027-03-08.

## Procedure

1. Set the deployment's clock to `t0` + 24 hours + 1 minute, with no edit to the proposal in between.
2. As `alice`, try to approve the proposal.
3. Read `A`.

## Expected response

- The proposal is reported as expired, and the approval is rejected.

## Negative assertions

- `A` still starts 2027-03-01.

## Cleanup

Discard the test deployment.
