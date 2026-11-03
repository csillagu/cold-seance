# TC-097: A proposal is recorded as its set of changes to the plan

Verifies [FR-069](FR-069-record-a-proposal-as-a-set-of-changes-to-planning.md).

## Intent

Verify that the system records a proposal as a set of changes against the current plan: new tasks, date moves, assignments and constraints.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Tasks in `Apollo`: `A` (2027-03-01, 1 working day) and `B` (2027-03-08, 1 working day), no assigned people, no relations.
- A proposal, created through the MCP server with `alice`'s token, of four changes: new task `C`; `A` moved to start on 2027-03-02; `bob` assigned to `B`; `B` blocked by `A`.

## Procedure

1. Create the proposal.
2. Read it as `alice` through the REST API.

## Expected response

- The proposal holds exactly the four changes given.

## Negative assertions

- The proposal holds no copy of tasks or fields it does not change.

## Cleanup

Discard the test deployment.
