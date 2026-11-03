# TC-099: Keeping a group of proposed changes keeps every change in it

Verifies [FR-070](FR-070-keep-a-proposal-s-grouped-changes-together.md).

## Intent

Verify that a group of changes in a proposal is kept as one.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- Tasks `A` (2027-03-01) and `B` (2027-03-02) in `Apollo`, 1 working day each.
- A proposal, created through the MCP server, with group `G1` (move `A` to 2027-03-08; move `B` to 2027-03-09).

## Procedure

1. As `alice`, approve the proposal with `G1` kept.
2. Read `A` and `B`.

## Expected response

- `A` starts 2027-03-08 and `B` 2027-03-09.

## Negative assertions

- Neither move is applied without the other.

## Cleanup

Discard the test deployment.
