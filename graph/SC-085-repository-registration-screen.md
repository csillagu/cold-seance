---
certainty: assumed
effort: 2
---

# SC-085: Repository registration screen

The screen on which anyone with an account registers a repository the GitHub App can reach and that nobody has registered yet. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a person can pick a repository the GitHub App has access to and nobody has registered, register it and become its admin, and cannot register a repository that is already registered.

It delivers:

- [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md): Let anyone with an account register an unregistered repository and become its admin

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
