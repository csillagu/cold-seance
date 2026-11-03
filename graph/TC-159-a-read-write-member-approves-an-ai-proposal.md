# TC-159: A read-write member approves an AI proposal

Verifies [FR-108](FR-108-let-the-read-write-role-edit-the-plan-and-handle-p.md).

## Intent

Verify that a person with the read-write role in a project can review and approve its AI proposals.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `T` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `T` to 2027-03-08.

## Procedure

1. As `bob`, open the proposal and approve it.
2. Read `T`.

## Expected response

- The approval is accepted and `T` starts 2027-03-08.

## Negative assertions

- The proposal is no longer waiting for review.

## Cleanup

Discard the test deployment.
