# TC-195: A multi-project proposal applies nothing until every part is approved

Verifies [FR-132](FR-132-apply-a-multi-project-proposal-only-when-every-par.md).

## Intent

Verify that a proposal spanning several projects applies none of its changes until every project's part has been approved.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`.
- Project `Apollo` created by `alice`, with task `A` (2027-03-01, 1 working day); project `Borealis` created by `bob`, with task `B` (2027-03-01, 1 working day), where `alice` has the read-only role.
- A proposal, created through the MCP server with `alice`'s token, moving `A` and `B` to 2027-03-08.

## Procedure

1. As `alice`, approve the `Apollo` part. Read `A` and `B`.
2. As `bob`, approve the `Borealis` part. Read `A` and `B`.

## Expected response

- After step 1, `A` and `B` both still start 2027-03-01.
- After step 2, `A` and `B` both start 2027-03-08.

## Negative assertions

- At no point is only one of the two moves applied.

## Cleanup

Discard the test deployment.
