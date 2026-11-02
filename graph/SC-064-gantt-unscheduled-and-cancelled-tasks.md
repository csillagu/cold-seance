---
certainty: assumed
effort: 2
---

# SC-064: Gantt unscheduled and cancelled tasks

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that lays unscheduled tasks at the bottom and shows cancelled tasks somewhat opaque.

It is done when unscheduled tasks appear below every scheduled task on the Gantt, and cancelled tasks still appear, drawn more transparent than the other tasks.

It delivers:

- [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md): Show unscheduled tasks in every view kind
- [FR-129](FR-129-show-cancelled-tasks-in-the-kanban-s-cancelled-col.md): Show cancelled tasks in the Kanban's cancelled column and faded on the Gantt
- [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md): Lay unscheduled tasks at the bottom of the Kanban and the Gantt

Origin: split off from SC-031, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
