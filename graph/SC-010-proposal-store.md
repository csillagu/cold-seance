---
certainty: assumed
effort: 3
---

# SC-010: Proposal store

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that records a proposal as changes to planning inputs only ([DD-020](DD-020-a-proposal-stores-only-planning-inputs.md)), held in the groups the AI made ([DD-023](DD-023-proposal-changes-are-grouped.md)), with who created it, the channel it came through and the time it was last edited. It takes any change to a project's tasks, from a read-write member or admin of each project it changes, through the REST API or the MCP server.

It delivers:

- [FR-069](FR-069-record-a-proposal-as-a-set-of-changes-to-planning.md): Record a proposal as a set of changes to planning inputs
- [FR-070](FR-070-keep-a-proposal-s-grouped-changes-together.md): Keep a proposal's grouped changes together
- [FR-154](FR-154-store-only-planning-inputs-in-a-proposal.md): Store only planning inputs in a proposal
- [FR-203](FR-203-let-only-read-write-members-and-admins-create-a-pr.md): Let only read-write members and admins create a proposal
- [FR-204](FR-204-accept-a-new-proposal-through-the-rest-api-and-the.md): Accept a new proposal through the REST API and the MCP server only: through the REST API, and refused through the UI; the MCP server offers it with [SC-027](SC-027-mcp-server-endpoint.md)
- [FR-205](FR-205-accept-any-change-to-a-project-s-tasks-in-a-propos.md): Accept any change to a project's tasks in a proposal

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it. FR-203 to FR-205 were added for issue #114, from the owner's answers in the design session of 2026-11-06.
