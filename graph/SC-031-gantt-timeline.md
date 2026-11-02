---
certainty: assumed
effort: 8
---

# SC-031: Gantt timeline

The project's own React component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that draws a Gantt's timeline: tasks as bars on their dates, the dependencies between them, the milestones, and constraint violations, such as a pushed fixed-date milestone, in red.

It delivers:

- [FR-013](FR-013-show-a-red-violation-when-a-fixed-date-milestone-i.md): Show a red violation when a fixed-date milestone is pushed
- [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md): Provide the Kanban, Gantt, person load and baseline variance views
- [FR-049](FR-049-show-the-schedule-dependencies-milestones-and-viol.md): Show the schedule, dependencies, milestones and violations on the Gantt

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
