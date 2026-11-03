# TC-019: A move onto a weekend never reaches the plan through the MCP server

Verifies [FR-011](FR-011-block-moving-a-task-to-a-forbidden-date.md).

## Intent

Verify that a change that arrives through the MCP server and moves a task onto one of its forbidden dates is rejected.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`; project `Apollo` created by `alice`; `bob` has the read-write role in it.
- Task `T` in `Apollo`, unassigned, planned start 2027-03-01, duration 1 working day.
- An MCP client using `bob`'s access token.

## Procedure

1. Through the MCP server, create a proposal that moves `T` to start on 2027-03-06 (Saturday).
2. If the proposal is accepted, open it as `alice` and approve it.
3. Read `T` through the REST API.

## Expected response

- The system reports a rejection, either at step 1 (the proposal is refused) or at step 2 (the approval is refused). Not stated: at which of the two points the rejection comes; either passes.
- `T` still starts on 2027-03-01.

## Negative assertions

- `T` is never stored on 2027-03-06.

## Cleanup

Discard the test deployment.
