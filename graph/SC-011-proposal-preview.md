---
certainty: assumed
effort: 5
---

# SC-011: Proposal preview

The function of the service layer that applies a proposal's inputs to an in-memory copy of the live plan, runs the scheduler on it ([DD-046](DD-046-scheduling-is-the-project-s-own-code-in-the-servic.md)) and returns the differences and new red flags ([DD-021](DD-021-proposal-live-preview-against-the-current-plan.md)), leaving the live plan untouched and never rebasing the proposal.

It delivers:

- [FR-071](FR-071-leave-the-live-plan-unchanged-until-a-proposal-is.md): Leave the live plan unchanged until a proposal is approved
- [FR-072](FR-072-preview-a-proposal-against-the-current-plan.md): Preview a proposal against the current plan
- [FR-079](FR-079-never-rebase-a-proposal-beyond-its-live-preview.md): Never rebase a proposal beyond its live preview

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
