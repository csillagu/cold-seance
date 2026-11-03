# TC-098: Dropping a group of proposed changes drops every change in it

Verifies [FR-070](FR-070-keep-a-proposal-s-grouped-changes-together.md).

## Intent

Verify that a group of changes in a proposal is dropped as one.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Tasks `A` (2027-03-01) and `B` (2027-03-02) in `Apollo`, 1 working day each.
- A proposal, created through the MCP server, with group `G1` (move `A` to 2027-03-08; move `B` to 2027-03-09) and group `G2` (assign `bob` to `A`).

## Procedure

1. As `alice`, open the proposal in the browser and try to drop only the move of `A`.
2. Drop group `G1`.
3. Approve the proposal.
4. Read `A` and `B`.

## Expected response

- At step 1, the move of `A` cannot be dropped on its own.
- After step 4, `A` and `B` are on their old dates and `bob` is assigned to `A`.

## Negative assertions

- Neither move from `G1` is applied.

## Cleanup

Discard the test deployment.
