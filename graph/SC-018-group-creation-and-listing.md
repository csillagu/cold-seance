---
certainty: assumed
effort: 2
---

# SC-018: Group creation and listing

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that lets anyone logged in create a group, makes its creator its admin, and shows every group to everyone.

It is done when anyone logged in can create a group, its creator then holds the admin role in it, and everyone sees every group.

It delivers:

- [FR-121](FR-121-let-anyone-logged-in-create-a-group.md): Let anyone logged in create a group
- [FR-122](FR-122-show-every-group-to-everyone.md): Show every group to everyone
- [FR-159](FR-159-make-a-group-s-creator-its-admin.md): Make a group's creator its admin

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
