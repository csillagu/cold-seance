# SC-001: Task record module

The module of the backend's one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that creates, edits and stores tasks with their fields, takes durations in whole working days ([DD-006](DD-006-durations-are-whole-working-days.md)), and keeps a task with no planned dates as an unscheduled task of its project.

It delivers:

- [FR-001](FR-001-store-each-task-with-its-minimum-fields.md): Store each task with its minimum fields
- [FR-002](FR-002-take-task-durations-in-whole-working-days.md): Take task durations in whole working days
- [FR-003](FR-003-keep-a-task-without-planned-dates-as-unscheduled-i.md): Keep a task without planned dates as unscheduled in its project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
