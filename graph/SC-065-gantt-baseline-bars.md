---
certainty: assumed
effort: 2
---

# SC-065: Gantt baseline bars

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that shows a selected baseline as bars beside the planned ones.

It is done when, with a baseline selected, each task in it shows a bar for its baseline start and finish beside its planned bar, and with no baseline selected no baseline bars show.

It delivers:

- [FR-050](FR-050-show-a-baseline-as-bars-on-the-gantt.md): Show a baseline as bars on the Gantt

Origin: split off from SC-031, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
