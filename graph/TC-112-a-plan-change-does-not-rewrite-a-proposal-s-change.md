# TC-112: A plan change does not rewrite a proposal's changes

Verifies [FR-079](FR-079-never-rebase-a-proposal-beyond-its-live-preview.md).

## Intent

Verify that the system does not rebase a proposal automatically: only its live preview is recomputed.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- In `Apollo`: task `A`, 2027-03-01, 1 working day; task `B`, blocked by `A`, 1 working day (2027-03-02).
- A proposal, created through the MCP server, assigning `bob` to `B`.
- Then `bob` moves `A` to 2027-03-08, so `B` is rescheduled to 2027-03-09.

## Procedure

1. Read the proposal's changes through the REST API.
2. As `alice`, open the proposal's preview.

## Expected response

- The proposal still holds exactly one change: assign `bob` to `B`.
- The preview shows `B` on 2027-03-09, assigned to `bob`.

## Negative assertions

- No date or other change has been added to or altered in the proposal.

## Cleanup

Discard the test deployment.
