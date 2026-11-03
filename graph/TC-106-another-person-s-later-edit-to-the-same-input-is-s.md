# TC-106: Another person's later edit to the same input is shown as a conflict

Verifies [FR-076](FR-076-show-a-proposal-s-conflicts-for-the-reviewer-to-re.md).

## Intent

Verify that a change in a proposal is shown as a conflict when someone else edited the same input on the same task after the proposal was created.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08.
- Then `bob` sets `A`'s planned start to 2027-03-03.

## Procedure

1. As `alice`, open the proposal in the browser.

## Expected response

- The move of `A` is shown as a conflict, with the choice to resolve it or drop it.

## Negative assertions

- `A` is not moved by opening the proposal; it still starts 2027-03-03.

## Cleanup

Discard the test deployment.
