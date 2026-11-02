---
certainty: assumed
effort: 3
---

# SC-052: Sign-in

The function of the backend that signs a person in with their account held in the tool ([DD-027](DD-027-local-accounts-only-for-now.md)): it checks the password against its Argon2id hash ([DD-056](DD-056-passwords-are-stored-only-as-argon2id-hashes.md)) and creates a session stored in PostgreSQL, giving the browser only the session's id in a cookie ([DD-054](DD-054-sign-in-sessions-are-kept-in-postgresql-behind-a-c.md)). It is done when a correct password creates a session and sets the cookie, and a wrong one creates none.

It delivers:

- [FR-118](FR-118-sign-people-in-with-local-accounts.md): Sign people in with local accounts

Origin: split off from SC-015, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
