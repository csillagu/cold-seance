# TC-289: An address past 10 sign-in attempts in 60 seconds is refused, and others are not

Verifies [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md).

## Intent

Verify that the system refuses a sign-in attempt from a client address with 10 attempts in the 60 seconds before it, without checking its password, counts only attempts that went on to a password check, and keeps signing in other addresses.

## Inputs

- A fresh test deployment, first system admin `root`, `server.trustedProxies` not set; account `alice`, created by `root` with credentials `C`.
- A wrong set of credentials `W` for `alice`.
- Two client addresses, `A` and `B`.

## Procedure

1. From `A`, try to sign in as `alice` with `W` 10 times, within 10 seconds.
2. From `A`, try to sign in as `alice` with `C`, at once.
3. From `B`, sign in as `alice` with `C`, at once.
4. From `A`, try to sign in as `alice` with `C` 5 more times, at once.
5. From `A`, sign in as `alice` with `C`, 61 seconds after the first attempt of step 1.

## Expected response

- Each attempt of step 1 is refused as a wrong username or password.
- Step 2 is refused with 429, and `alice` is not signed in.
- Step 3 signs `alice` in.
- Each attempt of step 4 is refused with 429.
- Step 5 signs `alice` in.

## Negative assertions

- No session is created for the attempts of steps 2 and 4.

## Cleanup

Discard the test deployment.
