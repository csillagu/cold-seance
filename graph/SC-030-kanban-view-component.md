---
effort: 8
---

# SC-030: Kanban view component

The project's own React component for the Kanban ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): one column per task status, for one project or several, unscheduled tasks at the bottom, cancelled tasks in their column, a proposal under review as a pending overlay, and editing in place within what the viewer's role allows.

It delivers:

- [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md): Show unscheduled tasks in every view kind
- [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md): Provide the Kanban, Gantt, person load and baseline variance views
- [FR-048](FR-048-lay-out-the-kanban-in-columns-by-task-status.md): Lay out the Kanban in columns by task status
- [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md): Make everything shown in a view editable there unless noted
- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows
- [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md): Ask for the project when a task is created in a cross-project view
- [FR-073](FR-073-show-a-proposal-under-review-as-a-pending-overlay.md): Show a proposal under review as a pending overlay on the Gantt and Kanban
- [FR-129](FR-129-show-cancelled-tasks-in-the-kanban-s-cancelled-col.md): Show cancelled tasks in the Kanban's cancelled column and faded on the Gantt
- [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md): Lay unscheduled tasks at the bottom of the Kanban and the Gantt

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
