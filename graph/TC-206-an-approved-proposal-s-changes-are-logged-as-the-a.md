# TC-206: An approved proposal's changes are logged as the approver's

Verifies [FR-139](FR-139-record-the-approver-as-the-author-of-an-approved-a.md).

## Intent

Verify that, when an approved AI proposal is applied, the audit log records the approver as the one who made each change.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Tasks `A` and `B` in `Apollo`, each 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` and `B` to 2027-03-08.

## Procedure

1. As `bob`, approve the proposal.
2. As `alice`, read the audit log of `Apollo`.

## Expected response

- The entries for the moves of `A` and `B` each name `bob` as the one who made the change.

## Negative assertions

- Neither entry names `alice` as the one who made the change.

## Cleanup

Discard the test deployment.
