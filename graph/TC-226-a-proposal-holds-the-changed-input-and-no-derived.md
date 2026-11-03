# TC-226: A proposal holds the changed input and no derived dates

Verifies [FR-154](FR-154-store-only-planning-inputs-in-a-proposal.md).

## Intent

Verify that the system stores only planning inputs in a proposal, never dates the scheduler derives.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, with an access token; project `Apollo` created by `alice`.
- In `Apollo`: task `A`, 2027-03-01, 3 working days; task `B`, blocked by `A`, 2 working days (2027-03-04 to 2027-03-05).
- A proposal, created through the MCP server, setting `A`'s duration to 5 working days.

## Procedure

1. Read the proposal's stored content through the REST API.
2. Open the proposal's preview.

## Expected response

- The proposal holds one change: `A`'s duration set to 5.
- The preview shows `B` on 2027-03-08 to 2027-03-09.

## Negative assertions

- The stored proposal holds no planned finish for `A` and no dates for `B`.

## Cleanup

Discard the test deployment.
