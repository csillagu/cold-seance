# SC-001: Task module of the service layer

The module of the backend's one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that creates, edits and stores tasks with their fields, durations in whole working days ([DD-006](DD-006-durations-are-whole-working-days.md)), unscheduled tasks, and the repository a task is assigned to.

It delivers:

- [FR-001](FR-001-store-each-task-with-its-minimum-fields.md): Store each task with its minimum fields
- [FR-002](FR-002-take-task-durations-in-whole-working-days.md): Take task durations in whole working days
- [FR-003](FR-003-keep-a-task-without-planned-dates-as-unscheduled-i.md): Keep a task without planned dates as unscheduled in its project
- [FR-141](FR-141-let-a-task-be-assigned-to-a-repository.md): Let a task be assigned to a repository

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
