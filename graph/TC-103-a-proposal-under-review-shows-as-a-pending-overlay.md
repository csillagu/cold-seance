# TC-103: A proposal under review shows as a pending overlay on the Kanban

Verifies [FR-073](FR-073-show-a-proposal-under-review-as-a-pending-overlay.md).

## Intent

Verify that a proposal under review shows on the Kanban as a pending overlay, without touching the live plan.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- A proposal under review, created through the MCP server, adding a new task `Proposed task` to `Apollo`.

## Procedure

1. As `alice`, open the Kanban of `Apollo`.

## Expected response

- A card for `Proposed task` is shown, marked as pending, apart from the live cards.

## Negative assertions

- The task list of `Apollo` read through the REST API has no `Proposed task`.

## Cleanup

Discard the test deployment.
