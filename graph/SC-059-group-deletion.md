---
certainty: assumed
effort: 1
---

# SC-059: Group deletion

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that lets only a system admin delete a group, and deletes its saved views with it.

It delivers:

- [FR-126](FR-126-let-only-system-admins-delete-a-group.md): Let only system admins delete a group
- [FR-161](FR-161-delete-a-group-s-saved-views-with-the-group.md): Delete a group's saved views with the group

Origin: split off from SC-018, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
