# TC-291: Sign-in attempts through a trusted proxy are counted against the forwarded address

Verifies [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md).

## Intent

Verify that the system takes the client address of a sign-in attempt from the `X-Forwarded-For` header only when the setting for the reverse proxy says so, and from the address the request comes from otherwise.

## Inputs

- Account `alice` with credentials `C`, and a wrong set of credentials `W` for her.
- A reverse proxy at address `P`, and two client addresses behind it, `A` and `B`.
- Deployment 1: a fresh test deployment, first system admin `root`, `server.trustedProxies` set to `P`; `alice` created by `root`.
- Deployment 2: a fresh test deployment, first system admin `root`, `server.trustedProxies` not set; `alice` created by `root`.

## Procedure

1. On deployment 1, from `P`, with `X-Forwarded-For` naming `A`, try to sign in as `alice` with `W` 10 times, within 10 seconds.
2. On deployment 1, from `P`, with `X-Forwarded-For` naming `A`, try to sign in as `alice` with `C`, at once.
3. On deployment 1, from `P`, with `X-Forwarded-For` naming `B`, sign in as `alice` with `C`, at once.
4. On deployment 2, from `P`, try to sign in as `alice` with `W` 10 times within 10 seconds, the first five with `X-Forwarded-For` naming `A` and the others naming `B`.
5. On deployment 2, from `P`, with `X-Forwarded-For` naming `B`, try to sign in as `alice` with `C`, at once.

## Expected response

- Step 2 is refused with 429.
- Step 3 signs `alice` in.
- Step 5 is refused with 429: all 10 attempts of step 4 came from `P`.

## Negative assertions

- No session is created for the attempts of steps 2 and 5.

## Cleanup

Discard both test deployments.
