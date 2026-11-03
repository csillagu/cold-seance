# TC-116: An edit within 24 hours keeps a proposal from expiring

Verifies [FR-081](FR-081-expire-a-proposal-untouched-for-24-hours.md).

## Intent

Verify that an edit to a proposal restarts its 24 hours, so that only proposals untouched for 24 hours expire.

## Inputs

- A test deployment of the tool whose clock the tester can set forward; first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server at time `t0`, moving `A` to 2027-03-08.

## Procedure

1. Set the clock to `t0` + 23 hours. As `alice`, edit the proposal in the browser to move `A` to 2027-03-09.
2. Set the clock to `t0` + 25 hours.
3. As `alice`, approve the proposal and read `A`.

## Expected response

- The approval succeeds and `A` starts 2027-03-09.

## Negative assertions

- The proposal is not reported as expired at step 3.

## Cleanup

Discard the test deployment.
