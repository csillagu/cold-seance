---
certainty: assumed
effort: 1
---

# SC-116: Project search

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that finds projects by part of their name, ignoring case and the spaces around the search text, and returns only those the person searching has access to. The person's plain project list, which the search draws on, includes the projects they reach through groups.

It is done when a search returns every project whose name contains the trimmed search text, whatever its case, and that the person searching has access to, and never a project they cannot access; and when a person's project list includes every project they hold a role in through a group.

It delivers:

- [FR-183](FR-183-let-a-person-search-projects-by-part-of-their-name.md): Let a person search projects by part of their name, ignoring case
- [FR-184](FR-184-return-from-a-project-search-only-the-projects-the.md): Return from a project search only the projects the person can read
- [FR-188](FR-188-ignore-spaces-around-the-search-text-in-a-project.md): Ignore spaces around the search text in a project search
- [FR-189](FR-189-include-projects-reached-through-groups-in-a-perso.md): Include projects reached through groups in a person's project list

Origin: added by Claude for issue #15, at the owner's request in the design session of 2026-11-03 ("new backend sc"), for the backend side of the project search bar (SC-114). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation. FR-188 and FR-189 were added for issue #61, from the owner's answers in the design session of 2026-11-04; putting FR-189 in this SC rather than one of its own is Claude's choice and awaits the owner's confirmation.
