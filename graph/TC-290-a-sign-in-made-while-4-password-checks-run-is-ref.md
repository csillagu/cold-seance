# TC-290: A sign-in made while 4 password checks run is refused at once

Verifies [FR-216](FR-216-run-at-most-4-sign-in-password-checks-at-once.md).

## Intent

Verify that the system runs at most 4 sign-in password checks at once, and refuses at once, without checking its password, a sign-in attempt made while 4 are running, which can then be retried.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, created by `root` with credentials `C`.
- A test deployment whose password check of a sign-in does not end until the test releases it.
- Six client addresses, `A1` to `A6`.

## Procedure

1. From `A1` to `A4`, start one sign-in each as `alice` with `C`, and hold their password checks.
2. From `A5`, try to sign in as `alice` with `C`.
3. Release the checks of step 1, and wait for their answers.
4. From `A6`, sign in as `alice` with `C`.

## Expected response

- Step 2 is refused with 429 before any of the checks of step 1 is released.
- Each sign-in of step 1 signs `alice` in once its check is released.
- Step 4 signs `alice` in.

## Negative assertions

- No password check is started for the attempt of step 2, and no session is created for it.

## Cleanup

Discard the test deployment.
