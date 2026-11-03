# TC-205: Read-only members and contributors are refused the audit log

Verifies [FR-138](FR-138-let-system-admins-read-the-whole-audit-log-and-pro.md).

## Intent

Verify that people who are neither system admins nor admins or read-write members of a project are refused its audit log.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- Project `Apollo` created by `alice`, where `bob` has the read-only role and `carol` the contributor role; task `A` renamed by `alice`.

## Procedure

1. As `bob`, try to read the audit log of `Apollo`.
2. As `carol`, try the same.

## Expected response

- Both are refused.

## Negative assertions

- Neither sees the renaming of `A`.

## Cleanup

Discard the test deployment.
