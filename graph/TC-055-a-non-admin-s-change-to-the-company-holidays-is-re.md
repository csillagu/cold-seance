# TC-055: A non-admin's change to the company holidays is rejected

Verifies [FR-041](FR-041-let-system-admins-manage-the-company-holidays.md).

## Intent

Verify that the system rejects a change to the company holidays from anyone who is not a system admin.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with no company holidays.
- Account `alice`, not a system admin; project `Apollo` created by `alice` (so she is a project admin).
- The change: add a company holiday on 2027-03-03.

## Procedure

1. As `alice`, send the change through the REST API.
2. Read the global calendar.

## Expected response

- The REST API reports a rejection.
- The global calendar holds no company holidays.

## Negative assertions

- No audit log entry records a change to the global calendar.

## Cleanup

Discard the test deployment.
