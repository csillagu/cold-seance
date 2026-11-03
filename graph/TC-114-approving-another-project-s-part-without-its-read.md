# TC-114: Approving another project's part without its read-write role is rejected

Verifies [FR-080](FR-080-let-each-project-s-part-of-a-proposal-be-approved.md).

## Intent

Verify that, in a proposal spanning several projects, a person without the read-write role in a project cannot approve that project's part.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`.
- Project `Apollo` created by `alice`, with task `A` (2027-03-01, 1 working day); project `Borealis` created by `bob`, with task `B` (2027-03-01, 1 working day), where `alice` has the read-only role.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08 and `B` to 2027-03-08.

## Procedure

1. As `alice`, try to approve the `Borealis` part of the proposal.
2. Read the proposal's state through the REST API.

## Expected response

- The approval is rejected.
- The `Borealis` part is still not approved.

## Negative assertions

- `B` still starts 2027-03-01.

## Cleanup

Discard the test deployment.
