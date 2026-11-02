# SC-032: Person load view component

The React component for the person load view ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): each person's load per day across all projects against their capacity, overloads in red, unassigned tasks rated red, amber or green, and load from projects the viewer cannot read shown only as a percentage ([DD-014](DD-014-load-visibility-across-projects.md)).

It delivers:

- [FR-004](FR-004-show-unscheduled-tasks-in-every-view-kind.md): Show unscheduled tasks in every view kind
- [FR-042](FR-042-mark-a-person-overloaded-on-any-day-their-load-exc.md): Mark a person overloaded on any day their load exceeds their capacity
- [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md): Rate an eligible but unassigned task red, amber or green by load
- [FR-046](FR-046-show-load-from-unreadable-projects-only-as-a-perce.md): Show load from unreadable projects only as a percentage
- [FR-047](FR-047-provide-the-kanban-gantt-person-load-and-baseline.md): Provide the Kanban, Gantt, person load and baseline variance views
- [FR-051](FR-051-show-each-person-s-load-per-day-across-all-project.md): Show each person's load per day across all projects

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
