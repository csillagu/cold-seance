# SC-016: Personal access token management

The module of the service layer that lets each user create, list and revoke their own API tokens: a random secret shown once, stored only as a hash, with an optional expiry date ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)).

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
