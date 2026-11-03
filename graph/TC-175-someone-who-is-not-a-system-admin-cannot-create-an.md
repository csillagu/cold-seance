# TC-175: Someone who is not a system admin cannot create an account

Verifies [FR-117](FR-117-let-only-system-admins-create-accounts.md).

## Intent

Verify that a person who is not a system admin cannot create an account.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, not a system admin, admin of project `Apollo`.
- The new account `erin`.

## Procedure

1. As `alice`, try to create `erin` through the REST API and look for a way to do so in the browser.
2. Try to sign in as `erin`.

## Expected response

- The REST API rejects the attempt, and the browser offers `alice` no way to create accounts.

## Negative assertions

- No account `erin` exists: the sign-in fails.

## Cleanup

Discard the test deployment.
