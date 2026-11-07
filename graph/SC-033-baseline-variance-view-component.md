---
certainty: assumed
effort: 3
---

# SC-033: Baseline variance view component

The read-only React component for the baseline variance view ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): each task's planned, baseline and actual dates side by side, with the variance computed against the selected baseline ([DD-037](DD-037-variance-is-computed-not-stored.md)).

It looks as the approved design shows ([SRC-249](SRC-249-the-frontend-looks-as-the-approved-design-shows.md)).

It delivers:

- [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md): Show unscheduled tasks in every view kind
- [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md): Provide the Kanban, Gantt, person load and baseline variance views
- [FR-052](FR-052-keep-the-baseline-variance-view-read-only.md): Keep the baseline variance view read-only
- [FR-152](FR-152-compare-planned-baseline-and-actual-dates-in-the-b.md): Compare planned, baseline and actual dates in the baseline variance view

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".

The link to SRC-249 was added at the owner's request in the design session of 2026-11-07: "yes, those should link".
