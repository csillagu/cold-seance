# SC-031: Gantt view component

The project's own React component for the Gantt ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): the schedule, dependencies (also between projects) and milestones, violations in red, a selected baseline as bars, unscheduled tasks at the bottom, cancelled tasks faded, a proposal under review as a pending overlay, and editing in place within what the viewer's role allows.

It delivers:

- [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md): Show unscheduled tasks in every view kind
- [FR-013](FR-013-show-a-red-violation-when-a-fixed-date-milestone-i.md): Show a red violation when a fixed-date milestone is pushed
- [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md): Provide the Kanban, Gantt, person load and baseline variance views
- [FR-049](FR-049-show-the-schedule-dependencies-milestones-and-viol.md): Show the schedule, dependencies, milestones and violations on the Gantt
- [FR-050](FR-050-show-a-baseline-as-bars-on-the-gantt.md): Show a baseline as bars on the Gantt
- [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md): Make everything shown in a view editable there unless noted
- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows
- [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md): Ask for the project when a task is created in a cross-project view
- [FR-062](FR-062-draw-dependencies-between-projects-on-a-cross-proj.md): Draw dependencies between projects on a cross-project Gantt
- [FR-073](FR-073-show-a-proposal-under-review-as-a-pending-overlay.md): Show a proposal under review as a pending overlay on the Gantt and Kanban
- [FR-129](FR-129-show-cancelled-tasks-in-the-kanban-s-cancelled-col.md): Show cancelled tasks in the Kanban's cancelled column and faded on the Gantt
- [FR-145](FR-145-lay-unscheduled-tasks-at-the-bottom-of-the-kanban.md): Lay unscheduled tasks at the bottom of the Kanban and the Gantt

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
