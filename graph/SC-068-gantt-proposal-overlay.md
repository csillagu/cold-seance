---
certainty: assumed
effort: 3
---

# SC-068: Gantt proposal overlay

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that shows a proposal under review as a pending overlay over the live plan.

It is done when, while a proposal is under review, its changes show on the Gantt marked as pending, apart from the live plan, and the live plan is unchanged until the proposal is approved.

It delivers:

- [FR-073](FR-073-show-a-proposal-under-review-as-a-pending-overlay.md): Show a proposal under review as a pending overlay on the Gantt and Kanban

Origin: split off from SC-031, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
