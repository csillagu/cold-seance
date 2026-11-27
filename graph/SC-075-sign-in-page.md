---
certainty: assumed
effort: 2
---

# SC-075: Sign-in page

The page on which a person signs in with their account held in the tool ([DD-027](DD-027-local-accounts-only-for-now.md)). It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It looks as the approved design shows ([SRC-249](SRC-249-the-frontend-looks-as-the-approved-design-shows.md)).

When the backend refuses a sign-in for too many attempts, with 429, the page says, in the same alert as its other failures: "Signing in failed: too many attempts. Wait a minute and try again." ([SRC-298](SRC-298-sign-in-attempts-are-limited-per-client-address-a.md)).

It is done when a person can sign in with their account, is signed in on success as DD-054 sets out, and is told when signing in failed, and that it was refused for too many attempts when it was.

It delivers:

- [FR-118](FR-118-sign-people-in-with-local-accounts.md): Sign people in with local accounts
- [FR-215](FR-215-limit-each-client-address-to-10-sign-in-attempts.md): Limit each client address to 10 sign-in attempts in any 60 seconds
- [FR-216](FR-216-run-at-most-4-sign-in-password-checks-at-once.md): Run at most 4 sign-in password checks at once

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.

The link to SRC-249 was added at the owner's request in the design session of 2026-11-07: "yes, those should link".

The message for a sign-in refused for too many attempts, and the links to FR-215 and FR-216, were added by Claude for issue #274, from the owner's answers in the design session of 2026-11-27 (SRC-298).
