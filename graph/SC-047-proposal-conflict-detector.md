---
certainty: assumed
effort: 3
---

# SC-047: Proposal conflict detector

The function of the service layer that marks as a conflict each change in a proposal whose input on the same task was edited by someone else after the proposal was created, or whose task was deleted ([DD-022](DD-022-proposal-conflicts-are-real-conflicts-only.md)).

It delivers:

- [FR-076](FR-076-show-a-proposal-s-conflicts-for-the-reviewer-to-re.md): Show a proposal's conflicts for the reviewer to resolve or drop

Origin: split off from SC-011, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
