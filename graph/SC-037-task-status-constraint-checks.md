# SC-037: Task status constraint checks

The checks in the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that reject finishing a parent task while a subtask is open and starting a task before its blockers have finished, whichever channel the change comes through.

It delivers:

- [FR-025](FR-025-reject-finishing-a-parent-task-while-a-subtask-is.md): Reject finishing a parent task while a subtask is open
- [FR-026](FR-026-reject-starting-a-blocked-task-before-its-blocker.md): Reject starting a blocked task before its blocker finishes

Origin: split off from SC-003, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
