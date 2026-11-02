---
certainty: assumed
---

# SC-107: Session check

The step on each request from the browser that looks up the session id from its cookie in PostgreSQL, treats the request as made by that session's person or rejects it when the session does not exist, and deletes the session when the person signs out ([DD-054](DD-054-sign-in-sessions-are-kept-in-postgresql-behind-a-c.md)). It is done when a request with a live session's cookie acts as its person, and one without a cookie, or after signing out, is refused.

It delivers:

- [FR-118](FR-118-sign-people-in-with-local-accounts.md): Sign people in with local accounts

Origin: split off from SC-052, which the quality review found bundled (signing in and keeping a person signed in), after the owner chose how sessions are kept in the design session of 2026-11-02: "Sessions: as recommended". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
