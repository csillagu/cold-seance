---
certainty: assumed
---

# FR-186: Notify every system admin when a personal access token stops working

When GitHub refuses a personal access token the tool uses as expired or revoked, the system must notify every system admin in the app ([SRC-232](SRC-232-the-system-admin-is-notified-of-an-expired-or-revo.md), [DD-003](DD-003-notifications-are-in-app-only.md)), naming the GitHub function the token is given for ([DD-060](DD-060-a-github-function-is-given-an-app-or-a-personal-ac.md)).

Not stated: how often the notification repeats while the token stays unusable.

No use case covers installing or running the tool; this obligation rests on the linked items directly.

Origin: composed by Claude from the items linked above, for issue #37. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. It awaits the owner's confirmation.
