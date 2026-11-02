---
certainty: assumed
effort: 3
---

# SC-010: Proposal store

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that records a proposal as changes to planning inputs only ([DD-020](DD-020-a-proposal-stores-only-planning-inputs.md)), held in the groups the AI made ([DD-023](DD-023-proposal-changes-are-grouped.md)), with the time it was last edited.

It delivers:

- [FR-069](FR-069-record-a-proposal-as-a-set-of-changes-to-planning.md): Record a proposal as a set of changes to planning inputs
- [FR-070](FR-070-keep-a-proposal-s-grouped-changes-together.md): Keep a proposal's grouped changes together
- [FR-154](FR-154-store-only-planning-inputs-in-a-proposal.md): Store only planning inputs in a proposal

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
