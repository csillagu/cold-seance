# TC-291: Sign-in attempts through a trusted proxy are counted against the forwarded address

Verifies [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md).

## Intent

Verify that, when the setting for the reverse proxy names it, the system counts a sign-in attempt that comes through that proxy against the client address the proxy forwards in `X-Forwarded-For`, not against the proxy's own address.

## Inputs

- A fresh test deployment, first system admin `root`, `server.trustedProxies` set to `P`; account `alice`, created by `root` with credentials `C`.
- A wrong set of credentials `W` for `alice`.
- A reverse proxy at address `P`, and two client addresses behind it, `A` and `B`.

## Procedure

1. From `P`, with `X-Forwarded-For` naming `A`, try to sign in as `alice` with `W` 10 times, within 10 seconds.
2. From `P`, with `X-Forwarded-For` naming `A`, try to sign in as `alice` with `C`, at once.
3. From `P`, with `X-Forwarded-For` naming `B`, sign in as `alice` with `C`, at once.

## Expected response

- Step 2 is refused with 429.
- Step 3 signs `alice` in.

## Negative assertions

- No session is created for the attempt of step 2.

## Cleanup

Discard the test deployment.
