# DD-054: Sign-in sessions are kept in PostgreSQL behind a cookie; passwords are hashed with Argon2id

## Decision

When a person signs in with their local account ([DD-027](DD-027-local-accounts-only-for-now.md)), the backend creates a session, stores it in PostgreSQL ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)), and gives the browser only a random session id in a cookie. Page scripts cannot read the cookie, it is sent only over HTTPS, and it is not sent with requests that other sites start. Signing out deletes the session at once.

Passwords are stored only as Argon2id hashes.

## Alternatives considered

- Sessions stored in PostgreSQL, with an opaque id in a cookie.
- Signed tokens (JWTs) in a cookie, checked without a database lookup.
- The personal access tokens of [DD-048](DD-048-api-access-uses-personal-access-tokens.md), kept in the browser.

## Rationale

A session kept in the database ends the moment it is deleted, the same reason API tokens are stored as hashes ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)). A signed token stays valid until it expires. A token kept where page scripts can read it can be stolen by any script that runs on the page. Argon2id is the password hash the OWASP Password Storage Cheat Sheet recommends first.

## Trade-offs

- Each request from the browser needs a database lookup for its session.
- A cookie-based session needs protection against requests forged by other sites. The cookie's same-site setting gives part of it.

## Risks

- Without HTTPS from the deployment, the cookie cannot be marked secure, and the session id can be read in transit.
- Sessions that are never cleaned up pile up in the database.
- Argon2id is slow on purpose, so many sign-in attempts load the backend unless they are limited.

## Serves

This decision serves [DD-027](DD-027-local-accounts-only-for-now.md), [FR-118](FR-118-sign-people-in-with-local-accounts.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md).

Origin: Claude set out these options with its recommendation in the design session of 2026-11-02, because the quality review found the sign-in component vague: how passwords are stored and how sessions are kept had not been stated. The owner answered: "Sessions: as recommended". The wording, alternatives, rationale, trade-offs and risks are Claude's.
