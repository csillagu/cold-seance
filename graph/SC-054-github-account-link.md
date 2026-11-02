---
certainty: assumed
effort: 2
---

# SC-054: GitHub account link

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that lets a person, or a system admin, link the person's account to their GitHub account.

It is done when a person can link their own account to a GitHub account and a system admin can link anyone's. How the GitHub account is identified, for example by its name or by signing in to GitHub, is not stated.

It delivers:

- [FR-135](FR-135-let-a-person-or-a-system-admin-link-the-person-s-g.md): Let a person or a system admin link the person's GitHub account

Origin: split off from SC-015, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
