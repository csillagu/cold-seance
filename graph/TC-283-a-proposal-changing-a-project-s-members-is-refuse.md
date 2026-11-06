# TC-283: A proposal changing a project's members is refused

Verifies [FR-207](FR-207-refuse-a-proposal-that-changes-anything-but-tasks.md).

## Intent

Verify that the system refuses a proposal that changes something other than a project's tasks, such as a member's role.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- The proposal: one group of one change, giving `bob` the read-write role in `Apollo`.

## Procedure

1. Through the REST API with `alice`'s token, create the proposal.
2. As `alice`, list `Apollo`'s proposals and its members.

## Expected response

- At step 1, the request is reported as refused, as not a change a proposal can hold.
- At step 2, `Apollo` has no proposals, and `bob` has the read-only role.

## Negative assertions

- No proposal is stored, and `bob`'s role is not changed.

## Cleanup

Discard the test deployment.
