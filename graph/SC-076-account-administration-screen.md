---
certainty: assumed
effort: 2
---

# SC-076: Account administration screen

The screen on which system admins create accounts and make other people system admins ([DD-027](DD-027-local-accounts-only-for-now.md)). It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a system admin can create an account and make another person a system admin from the screen, and no one else can.

It delivers:

- [FR-117](FR-117-let-only-system-admins-create-accounts.md): Let only system admins create accounts
- [FR-140](FR-140-let-system-admins-make-other-people-system-admins.md): Let system admins make other people system admins

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
