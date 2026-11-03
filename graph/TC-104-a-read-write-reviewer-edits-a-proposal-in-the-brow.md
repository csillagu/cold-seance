# TC-104: A read-write reviewer edits a proposal in the browser

Verifies [FR-074](FR-074-let-a-reviewer-edit-a-proposal-in-the-browser.md).

## Intent

Verify that a person with the read-write role can edit a proposal in the browser before approving it.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08.

## Procedure

1. As `bob`, open the proposal in the browser and change the proposed start of `A` to 2027-03-10. Save the proposal without approving it.
2. Read the proposal and `A` through the REST API.

## Expected response

- The proposal now moves `A` to 2027-03-10.

## Negative assertions

- `A` still starts 2027-03-01.

## Cleanup

Discard the test deployment.
