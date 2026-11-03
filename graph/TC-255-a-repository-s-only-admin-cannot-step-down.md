# TC-255: A repository's only admin cannot step down

Verifies [FR-175](FR-175-reject-leaving-a-repository-without-an-admin.md).

## Intent

Verify that the system rejects a change that would leave a registered repository without an admin.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, its only admin.

## Procedure

1. As `alice`, try to step down as admin of `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- The attempt is rejected; the admins are [`alice`].

## Negative assertions

- `tc-repo` is still registered.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
