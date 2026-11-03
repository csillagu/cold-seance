---
certainty: assumed
effort: 2
---

# SC-111: Receiving project register

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps, for each repository, its one receiving project: it marks a project as receiving, refuses a second one while one is marked, and lets the receiving project give the role up. It is done when a repository never has two receiving projects, and after the role is given up another project can be marked.

It delivers:

- [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md): Mark one receiving project for each repository
- [FR-179](FR-179-refuse-a-second-receiving-project-for-a-reposito.md): Refuse a second receiving project for a repository
- [FR-180](FR-180-let-the-receiving-project-s-admin-give-up-receivi.md): Let the receiving project's admin give up receiving

Origin: split off from SC-019 by Claude for issue #11, after its quality review found it bundled; the owner asked Claude to make such splits on its own in the design session of 2026-11-03. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's share of SC-019's confirmed effort of 8; the parts add up to it.
