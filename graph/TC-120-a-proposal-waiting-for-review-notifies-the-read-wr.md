# TC-120: A proposal waiting for review notifies the read-write members of its project

Verifies [FR-085](FR-085-notify-reviewers-of-a-proposal-waiting-for-review.md).

## Intent

Verify that, when a proposal is waiting for review, the people with the read-write role in a project it changes are notified.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token), `bob` and `carol`.
- Project `Apollo` created by `alice`; `bob` has the read-write role and `carol` the read-only role.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- The trigger: a proposal, created through the MCP server, moving `A` to 2027-03-08.

## Procedure

1. Make the trigger.
2. Within an hour, read the in-app notifications of `bob` and `carol`.

## Expected response

- `bob` has a notification that the proposal is waiting for review.

## Negative assertions

- `carol` has no notification asking her to review it.

## Cleanup

Discard the test deployment.
