# TC-100: A proposal leaves the live plan unchanged before approval

Verifies [FR-071](FR-071-leave-the-live-plan-unchanged-until-a-proposal-is.md).

## Intent

Verify that a proposal leaves the live plan unchanged until it is approved.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server, moving `A` to 2027-03-08.

## Procedure

1. Create the proposal.
2. As `alice`, open it in the browser, without approving it.
3. Read `A` through the REST API and open the plain Gantt of `Apollo`.

## Expected response

- `A` still starts 2027-03-01 in the REST API and in the live Gantt.

## Negative assertions

- The audit log records no change to `A`.

## Cleanup

Discard the test deployment.
