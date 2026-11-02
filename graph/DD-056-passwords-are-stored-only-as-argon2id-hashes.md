---
certainty: verified
---

# DD-056: Passwords are stored only as Argon2id hashes

## Decision

The password of each local account ([DD-027](DD-027-local-accounts-only-for-now.md)) is stored only as an Argon2id hash. Signing in checks the password given against that hash.

## Alternatives considered

Argon2id, versus other password hashes such as bcrypt or scrypt. Only Argon2id was set out to the owner; the others are named here for comparison.

## Rationale

Argon2id is the password hash the OWASP Password Storage Cheat Sheet recommends first.

## Trade-offs

Argon2id is slow and uses memory on purpose, so each sign-in costs the backend more than a fast hash would.

## Risks

- Many sign-in attempts load the backend unless they are limited.

## Serves

This decision serves [DD-027](DD-027-local-accounts-only-for-now.md), [FR-118](FR-118-sign-people-in-with-local-accounts.md).

Origin: split off from DD-054 at the owner's request in the design session of 2026-11-02 ("Dd54 split"), after the quality review found that DD-054 held two decisions. Claude set out the password hash with its recommendation for sessions, and the owner answered: "Sessions: as recommended". Confirmed by the owner in the same session: "Certainty verified".
