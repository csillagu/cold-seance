---
effort: 5
---

# SC-002: Task relation module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that records and validates the relations between tasks: subtask and parent, blocked-by within a project, and blocked by another project's milestone.

It delivers:

- [FR-014](FR-014-reject-a-blocked-by-relation-that-would-create-a-c.md): Reject a blocked-by relation that would create a cycle
- [FR-015](FR-015-record-a-task-blocked-by-another-project-s-milesto.md): Record a task blocked by another project's milestone
- [FR-016](FR-016-require-read-access-to-depend-on-another-project-s.md): Require read access to depend on another project's milestone

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
