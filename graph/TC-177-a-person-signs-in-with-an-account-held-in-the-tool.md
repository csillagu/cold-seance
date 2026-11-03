# TC-177: A person signs in with an account held in the tool

Verifies [FR-118](FR-118-sign-people-in-with-local-accounts.md).

## Intent

Verify that the system signs people in with accounts held in the tool itself.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, created by `root` with credentials `C`.
- A wrong set of credentials `W` for `alice`.

## Procedure

1. On the sign-in page, sign in as `alice` with `C`.
2. Sign out, and try to sign in as `alice` with `W`.

## Expected response

- Step 1 signs `alice` in.
- Step 2 is refused.

## Negative assertions

- The sign-in page offers no sign-in through an outside identity provider.

## Cleanup

Discard the test deployment.
