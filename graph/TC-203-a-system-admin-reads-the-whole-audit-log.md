# TC-203: A system admin reads the whole audit log

Verifies [FR-138](FR-138-let-system-admins-read-the-whole-audit-log-and-pro.md).

## Intent

Verify that a system admin can read the whole audit log.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`, with task `A` renamed by `alice`; project `Borealis` created by `bob`, with task `B` renamed by `bob`. `root` has no role in either.

## Procedure

1. As `root`, read the audit log.

## Expected response

- The log shows the renaming of `A` and of `B`.

## Negative assertions

- No entry is withheld for lack of a project role.

## Cleanup

Discard the test deployment.
