# TC-174: A system admin creates an account

Verifies [FR-117](FR-117-let-only-system-admins-create-accounts.md).

## Intent

Verify that a system admin can create an account.

## Inputs

- A fresh test deployment, first system admin `root`.
- The new account `erin`.

## Procedure

1. As `root`, create `erin`.
2. Sign in as `erin`.

## Expected response

- The account is created and `erin` can sign in.

## Negative assertions

- `erin` is not a system admin.

## Cleanup

Discard the test deployment.
