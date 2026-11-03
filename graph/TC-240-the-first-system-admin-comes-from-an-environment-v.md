# TC-240: The first system admin comes from an environment variable

Verifies [FR-165](FR-165-set-up-the-first-system-admin-from-an-environment.md).

## Intent

Verify that the system creates the first system admin from an environment variable.

## Inputs

- A fresh install of the tool with an empty database, started with the environment variable the tool documents for the first system admin, naming `root`.

## Procedure

1. Start the tool.
2. Sign in as `root` and create account `alice`.

## Expected response

- `root` exists, can sign in, and can create `alice`, so `root` is a system admin.

## Negative assertions

- No other account exists before step 2.

## Cleanup

Discard the test deployment.
