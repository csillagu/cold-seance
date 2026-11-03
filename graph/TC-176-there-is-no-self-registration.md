# TC-176: There is no self-registration

Verifies [FR-117](FR-117-let-only-system-admins-create-accounts.md).

## Intent

Verify that nobody can register an account for themselves.

## Inputs

- A fresh test deployment, first system admin `root`.
- A browser with no one signed in.

## Procedure

1. Open the tool's sign-in page and look for a way to register.
2. Without signing in, try to create account `erin` through the REST API.

## Expected response

- The sign-in page offers no registration.
- The REST API rejects the attempt.

## Negative assertions

- No account `erin` exists.

## Cleanup

Discard the test deployment.
