---
certainty: assumed
effort: 2
---

# SC-015: Account administration

The module of the service layer that lets system admins create the accounts held in the tool ([DD-027](DD-027-local-accounts-only-for-now.md)) and make other people system admins.

It is done when a system admin can create an account and make another person a system admin, and account creation is rejected for anyone else.

It delivers:

- [FR-117](FR-117-let-only-system-admins-create-accounts.md): Let only system admins create accounts
- [FR-140](FR-140-let-system-admins-make-other-people-system-admins.md): Let system admins make other people system admins

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
