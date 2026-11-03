# TC-256: A system admin cannot remove a repository's only admin

Verifies [FR-175](FR-175-reject-leaving-a-repository-without-an-admin.md).

## Intent

Verify that a change leaving a registered repository without an admin is rejected even when a system admin makes it.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, its only admin.

## Procedure

1. As `root`, try to remove `alice` as admin of `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- The attempt is rejected; the admins are [`alice`].

## Negative assertions

- `root` is not made an admin of `tc-repo` in `alice`'s place.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
