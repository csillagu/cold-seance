# TC-108: An edit to a different input on the same task is not a conflict

Verifies [FR-076](FR-076-show-a-proposal-s-conflicts-for-the-reviewer-to-re.md).

## Intent

Verify that an edit by someone else to a different input of the task is not shown as a conflict.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- Task `A` in `Apollo`, title `Draft`, 2027-03-01, 1 working day.
- A proposal, created through the MCP server with `alice`'s token, moving `A` to 2027-03-08.
- Then `bob` changes `A`'s title to `Draft v2`.

## Procedure

1. As `alice`, open the proposal in the browser.

## Expected response

- The proposal shows no conflict.

## Negative assertions

- The move of `A` is not marked as a conflict.

## Cleanup

Discard the test deployment.
