# TC-207: A system admin makes another person a system admin

Verifies [FR-140](FR-140-let-system-admins-make-other-people-system-admins.md).

## Intent

Verify that a system admin can make another person a system admin.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, not a system admin.

## Procedure

1. As `root`, make `alice` a system admin.
2. As `alice`, create account `erin`.

## Expected response

- Step 2 succeeds, since `alice` is now a system admin.

## Negative assertions

- `root` is still a system admin.

## Cleanup

Discard the test deployment.
