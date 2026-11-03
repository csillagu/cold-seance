# TC-101: Opening a proposal previews its rescheduled differences and new red flags

Verifies [FR-072](FR-072-preview-a-proposal-against-the-current-plan.md).

## Intent

Verify that opening a proposal applies its inputs to the current plan without saving them, reschedules, and shows the resulting differences and new red flags.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice` (capacity 100%, with an access token); project `Apollo` created by `alice`.
- In `Apollo`: task `A`, 2027-03-01, 3 working days; task `B`, blocked by `A`, 2 working days (2027-03-04 to 2027-03-05), assigned to `alice`, AI share 0%; task `C`, assigned to `alice`, AI share 0%, 2027-03-09, 1 working day.
- A proposal, created through the MCP server, setting `A`'s duration to 5 working days.

## Procedure

1. As `alice`, open the proposal in the browser.
2. Read `A`, `B` and `C` through the REST API.

## Expected response

- The preview shows `A` finishing 2027-03-05 and `B` moved to 2027-03-08 to 2027-03-09.
- The preview shows a new red flag: `alice` overloaded on 2027-03-09.

## Negative assertions

- At step 2, `A` still finishes 2027-03-03 and `B` runs 2027-03-04 to 2027-03-05: nothing was saved.

## Cleanup

Discard the test deployment.
