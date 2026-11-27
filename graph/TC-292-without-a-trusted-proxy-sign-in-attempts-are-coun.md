# TC-292: Without a trusted proxy, sign-in attempts are counted against the address they come from

Verifies [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md).

## Intent

Verify that, with the setting for the reverse proxy unset, which is the default, the system ignores `X-Forwarded-For` and counts each sign-in attempt against the address the request comes from, so that a client cannot escape the limit by naming other addresses in the header.

## Inputs

- A fresh test deployment, first system admin `root`, `server.trustedProxies` not set; account `alice`, created by `root` with credentials `C`.
- A wrong set of credentials `W` for `alice`.
- A client at address `P`, and two other addresses, `A` and `B`, that it names in `X-Forwarded-For`.

## Procedure

1. From `P`, try to sign in as `alice` with `W` 10 times within 10 seconds, the first five with `X-Forwarded-For` naming `A` and the others naming `B`.
2. From `P`, with `X-Forwarded-For` naming `B`, try to sign in as `alice` with `C`, at once.

## Expected response

- Step 2 is refused with 429: all 10 attempts of step 1 came from `P`.

## Negative assertions

- No session is created for the attempt of step 2.

## Cleanup

Discard the test deployment.
