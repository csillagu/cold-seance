---
certainty: assumed
effort: 1
---

# SC-116: Project search

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that finds projects by name and returns only those the person searching has access to ([SRC-220](SRC-220-the-header-holds-a-project-search-bar-that-finds-on.md)).

It is done when a search returns every project whose name matches and that the person searching has access to, and never a project they cannot access.

It delivers:

- [FR-183](FR-183-let-a-person-search-only-the-projects-they-can-re.md): Let a person search by name only the projects they can read

Origin: added by Claude for issue #15, at the owner's request in the design session of 2026-11-03 ("new backend sc"), for the backend side of the project search bar (SC-114). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
