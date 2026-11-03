# TC-204: Project admins and read-write members read only their projects' audit log

Verifies [FR-138](FR-138-let-system-admins-read-the-whole-audit-log-and-pro.md).

## Intent

Verify that a project's admins and read-write members can read the audit log of their own projects only.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `carol`.
- Project `Apollo` created by `alice`, where `carol` has the read-write role, with task `A` renamed by `alice`.
- Project `Borealis` created by `bob`, where `alice` and `carol` have the read-only role, with task `B` renamed by `bob`.

## Procedure

1. As `alice`, read the audit log of `Apollo`, then try to read that of `Borealis`.
2. As `carol`, do the same.

## Expected response

- Both read `Apollo`'s log, which shows the renaming of `A`.
- Both are refused `Borealis`'s log.

## Negative assertions

- No read by `alice` or `carol` shows the renaming of `B`.

## Cleanup

Discard the test deployment.
