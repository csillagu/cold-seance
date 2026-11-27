---
certainty: assumed
---

# FR-216: Run at most 4 sign-in password checks at once

The system must run at most 4 password checks of sign-in attempts at once across the server, and must refuse a sign-in attempt made while 4 are running with 429 straight away, without checking its password, so that it can be retried ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)).

It limits the sign-in of [FR-118](FR-118-sign-people-in-with-local-accounts.md).

Origin: composed by Claude from the items linked above, for issue #274. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. It awaits the owner's confirmation.
