---
certainty: assumed
effort: 2
---

# SC-132: Sign-in limits

The backend module that guards the sign-in route of [SC-052](SC-052-sign-in.md) before it checks a password ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)). It keeps, for each client address, the times of the attempts it let through in the last 60 seconds, and refuses an attempt from an address with 10 of them. It counts the password checks running, and refuses an attempt while 4 are. Each refusal answers 429 in the REST API's error shape. An attempt it lets through is counted against its address, and its password check is counted until it ends, whatever its outcome. The counts are held in the backend's memory, for each running backend.

It adds the setting `server.trustedProxies`: the addresses of the reverse proxies in front of the tool, as IP addresses or CIDR ranges. A request that comes from one of them is counted against the client address its `X-Forwarded-For` header gives; with the setting unset, which is the default, the header is ignored and every request is counted against the address it comes from. The configuration loader ([SC-109](SC-109-configuration-loader.md)) reads it as it reads the other settings, and refuses to start, naming it, when a value is not an IP address or range.

It is done when an 11th attempt from one address within 60 seconds is refused with 429 while another address still signs in, a 5th attempt while 4 password checks run is refused with 429, and, with `server.trustedProxies` set, attempts through the proxy are counted against the address in `X-Forwarded-For`.

It delivers:

- [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md): Limit each client address to 10 sign-in attempts in any 60 seconds
- [FR-216](FR-216-run-at-most-4-sign-in-password-checks-at-once.md): Run at most 4 sign-in password checks at once

Origin: added by Claude for issue #274. The boundary, name, setting name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
