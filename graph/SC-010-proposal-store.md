# SC-010: Proposal store

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that records a proposal as grouped changes to planning inputs only ([DD-020](DD-020-a-proposal-stores-only-planning-inputs.md), [DD-023](DD-023-proposal-changes-are-grouped.md)), lets a reviewer edit or reject it, and stores the time it was last edited, so that a proposal untouched for 24 hours counts as expired whenever it is read ([DD-024](DD-024-proposals-untouched-for-24-hours-expire.md), [DD-050](DD-050-proposal-expiry-is-computed-when-a-proposal-is-rea.md)).

It delivers:

- [FR-069](FR-069-record-a-proposal-as-a-set-of-changes-to-planning.md): Record a proposal as a set of changes to planning inputs
- [FR-070](FR-070-keep-a-proposal-s-grouped-changes-together.md): Keep a proposal's grouped changes together
- [FR-074](FR-074-let-a-reviewer-edit-a-proposal-in-the-browser.md): Let a reviewer edit a proposal in the browser
- [FR-075](FR-075-let-a-reviewer-reject-a-proposal.md): Let a reviewer reject a proposal
- [FR-081](FR-081-expire-a-proposal-untouched-for-24-hours.md): Expire a proposal untouched for 24 hours
- [FR-154](FR-154-store-only-planning-inputs-in-a-proposal.md): Store only planning inputs in a proposal

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
