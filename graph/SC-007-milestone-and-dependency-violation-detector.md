---
certainty: assumed
effort: 3
---

# SC-007: Milestone and dependency violation detector

The function of the service layer that finds the violations shown in red at milestones and dependencies ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)): a fixed-date milestone pushed past its date, a dependency on another project's milestone that lies after the dependent task's start, and any other conflict across a project boundary.

It delivers:

- [FR-013](FR-013-show-a-red-violation-when-a-fixed-date-milestone-i.md): Show a red violation when a fixed-date milestone is pushed
- [FR-019](FR-019-turn-a-cross-project-dependency-red-when-the-miles.md): Turn a cross-project dependency red when the milestone lies after the task's start
- [FR-147](FR-147-show-a-cross-project-conflict-in-red-for-the-owner.md): Show a cross-project conflict in red for the owners to resolve

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
