# TC-054: A system admin adds a company holiday

Verifies [FR-041](FR-041-let-system-admins-manage-the-company-holidays.md).

## Intent

Verify that a system admin can manage the company holidays in the global calendar.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with no company holidays.
- The change: add a company holiday on 2027-03-03, then remove it.

## Procedure

1. As `root`, add the holiday through the REST API and read the global calendar.
2. As `root`, remove the holiday and read the global calendar.

## Expected response

- After step 1 the global calendar holds the holiday on 2027-03-03.
- After step 2 it holds no company holidays.

## Negative assertions

- No person's own calendar changes.

## Cleanup

Discard the test deployment.
