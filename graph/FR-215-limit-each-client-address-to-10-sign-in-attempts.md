---
certainty: assumed
---

# FR-215: Limit each client address to 10 sign-in attempts in any 60 seconds

The system must refuse, with 429 and without checking its password, a sign-in attempt from a client IP address that already has 10 sign-in attempts in the 60 seconds before it ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)). Only attempts that went on to a password check count toward the 10 ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)).

The client address is the address the request comes from. Only when a configuration setting, off by default, says so must the system take it from the `X-Forwarded-For` header the reverse proxy sets instead ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)).

It limits the sign-in of [FR-118](FR-118-sign-people-in-with-local-accounts.md).

Origin: composed by Claude from the items linked above, for issue #274. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. It awaits the owner's confirmation.
