---
effort: 3
---

# SC-005: Eligibility and assignment module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that stores who can do a task, as an eligibility tree ([DD-038](DD-038-eligibility-is-stored-as-a-tree.md)), and who will do it, as a list of people. It accepts assignees outside the eligibility expression ([DD-031](DD-031-assignment-may-include-people-outside-the-eligibil.md)) and rejects people who cannot read the project ([DD-013](DD-013-shared-people-can-be-made-eligible-or-assigned-onl.md)).

It delivers:

- [FR-028](FR-028-store-eligibility-as-an-and-or-expression-up-to-tw.md): Store eligibility as an AND/OR expression up to two levels deep
- [FR-029](FR-029-store-assignment-as-a-concrete-list-of-people.md): Store assignment as a concrete list of people
- [FR-030](FR-030-accept-an-assignment-that-includes-people-outside.md): Accept an assignment that includes people outside the eligibility expression
- [FR-031](FR-031-reject-eligibility-or-assignment-for-someone-witho.md): Reject eligibility or assignment for someone without read access to the project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
