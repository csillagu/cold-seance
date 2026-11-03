# TC-110: A proposal whose change cannot be applied applies nothing

Verifies [FR-077](FR-077-apply-an-approved-proposal-s-changes-together.md).

## Intent

Verify that, when one of a proposal's changes cannot be applied on approval, none of them is applied.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `dave`; project `Apollo` created by `alice`, where `dave` has the read-only role.
- Tasks `A` (2027-03-01) and `B` (2027-03-02) in `Apollo`, 1 working day each.
- A proposal, created through the MCP server, moving `A` to 2027-03-08 and assigning `dave` to `B`.
- Then `alice` removes `dave` from `Apollo`, so `dave` can no longer be assigned there.

## Procedure

1. As `alice`, open the proposal and approve it.
2. Read `A` and `B` through the REST API.

## Expected response

- The approval reports that it could not be applied.
- `A` still starts 2027-03-01, and `B` has no assigned people.

## Negative assertions

- The move of `A` is not applied on its own.

## Cleanup

Discard the test deployment.
