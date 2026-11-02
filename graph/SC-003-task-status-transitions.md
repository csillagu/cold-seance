---
certainty: assumed
effort: 3
---

# SC-003: Task status transitions

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that moves a task through its statuses (in progress, on hold, done, back to in progress) and records its actual start and finish. Hold only marks the task ([DD-007](DD-007-hold-only-marks-a-task.md)).

It delivers:

- [FR-022](FR-022-record-a-task-s-actual-start-when-it-is-started.md): Record a task's actual start when it is started
- [FR-023](FR-023-record-a-task-s-actual-finish-when-it-is-finished.md): Record a task's actual finish when it is finished
- [FR-024](FR-024-leave-a-held-task-s-planned-finish-and-load-unchan.md): Leave a held task's planned finish and load unchanged

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
