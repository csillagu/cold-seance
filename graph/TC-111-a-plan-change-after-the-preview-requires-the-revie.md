# TC-111: A plan change after the preview requires the reviewer to confirm again

Verifies [FR-078](FR-078-ask-the-reviewer-to-confirm-again-if-the-plan-chan.md).

## Intent

Verify that, when the plan changed between the reviewer's preview and their approval, the system refreshes the preview and requires confirmation again before applying anything.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role.
- In `Apollo`: task `A`, 2027-03-01, 1 working day; task `C`, 2027-03-15, 1 working day.
- A proposal, created through the MCP server, moving `A` to 2027-03-08.

## Procedure

1. As `alice`, open the proposal in the browser (the preview).
2. As `bob`, move `C` to 2027-03-16.
3. As `alice`, approve the proposal from the preview opened at step 1.
4. Read `A` through the REST API.
5. Confirm the refreshed preview and read `A` again.

## Expected response

- At step 3 the preview is refreshed, showing `C` on 2027-03-16, and confirmation is asked again.
- At step 4 `A` still starts 2027-03-01.
- At step 5 `A` starts 2027-03-08.

## Negative assertions

- Nothing from the proposal is applied before the confirmation at step 5.

## Cleanup

Discard the test deployment.
