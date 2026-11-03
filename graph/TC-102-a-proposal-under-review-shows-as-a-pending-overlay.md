# TC-102: A proposal under review shows as a pending overlay on the Gantt

Verifies [FR-073](FR-073-show-a-proposal-under-review-as-a-pending-overlay.md).

## Intent

Verify that a proposal under review shows on the Gantt as a pending overlay, without touching the live plan.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice` (with an access token); project `Apollo` created by `alice`.
- Task `A` in `Apollo`, 2027-03-01, 1 working day.
- A proposal under review, created through the MCP server, moving `A` to 2027-03-08.

## Procedure

1. As `alice`, open the Gantt of `Apollo`.

## Expected response

- `A`'s live bar is on 2027-03-01.
- A pending bar for `A` on 2027-03-08 is shown, marked apart from the live plan.

## Negative assertions

- `A`, read through the REST API, still starts 2027-03-01.

## Cleanup

Discard the test deployment.
