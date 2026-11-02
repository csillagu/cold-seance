# SC-025: GitHub seeding importer

The backend module that seeds a project from one or more approved GitHub repositories in one all-or-nothing import: open issues as unscheduled tasks, closed issues as done with their closing date as actual finish ([DD-019](DD-019-the-initial-import-brings-in-closed-issues-too.md)), with their relations, assignees and status, skipping issues it cannot bring in cleanly. Every rule it applies is the service layer's ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)).

It delivers:

- [FR-102](FR-102-seed-a-project-from-one-or-more-github-repositorie.md): Seed a project from one or more GitHub repositories
- [FR-103](FR-103-import-open-issues-as-unscheduled-tasks.md): Import open issues as unscheduled tasks
- [FR-104](FR-104-import-closed-issues-as-done-tasks-with-their-actu.md): Import closed issues as done tasks with their actual finish
- [FR-137](FR-137-seed-a-project-all-or-nothing.md): Seed a project all or nothing
- [FR-163](FR-163-skip-issues-that-seeding-cannot-bring-in-cleanly.md): Skip issues that seeding cannot bring in cleanly

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
