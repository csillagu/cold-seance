---
certainty: assumed
effort: 2
---

# SC-086: Repository admins screen

The screen on which a repository's admins add and remove admins or step down, and system admins change them, never leaving the repository without one. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It delivers:

- [FR-169](FR-169-let-system-admins-change-a-repository-s-admins.md): Let system admins change a repository's admins
- [FR-174](FR-174-let-a-repository-s-admins-add-other-admins.md): Let a repository's admins add other admins
- [FR-175](FR-175-reject-leaving-a-repository-without-an-admin.md): Reject leaving a repository without an admin
- [FR-176](FR-176-let-a-repository-s-admins-remove-other-admins-or-s.md): Let a repository's admins remove other admins or step down

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
