# TC-109: Approving a proposal applies all of its changes

Verifies [FR-077](FR-077-apply-an-approved-proposal-s-changes-together.md).

## Intent

Verify that approving a proposal applies all of its approved changes.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Tasks `A` (2027-03-01) and `B` (2027-03-02) in `Apollo`, 1 working day each.
- A proposal, created through the MCP server, moving `A` to 2027-03-08 and assigning `bob` to `B`.

## Procedure

1. As `alice`, open and approve the proposal in the browser.
2. Read `A` and `B` through the REST API.

## Expected response

- `A` starts 2027-03-08 and `B`'s assigned people are [`bob`].

## Negative assertions

- No other task changes.

## Cleanup

Discard the test deployment.
