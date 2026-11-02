# SC-003: Task status module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that moves a task between statuses (start, hold, finish, reopen, cancel), records its actual dates, rejects status changes that break a constraint, and applies what cancelling does to the tasks it blocked. Hold only marks the task ([DD-007](DD-007-hold-only-marks-a-task.md)).

It delivers:

- [FR-022](FR-022-record-a-task-s-actual-start-when-it-is-started.md): Record a task's actual start when it is started
- [FR-023](FR-023-record-a-task-s-actual-finish-when-it-is-finished.md): Record a task's actual finish when it is finished
- [FR-024](FR-024-leave-a-held-task-s-planned-finish-and-load-unchan.md): Leave a held task's planned finish and load unchanged
- [FR-025](FR-025-reject-finishing-a-parent-task-while-a-subtask-is.md): Reject finishing a parent task while a subtask is open
- [FR-026](FR-026-reject-starting-a-blocked-task-before-its-blocker.md): Reject starting a blocked task before its blocker finishes
- [FR-027](FR-027-let-a-task-be-cancelled-in-the-tool.md): Let a task be cancelled in the tool
- [FR-128](FR-128-pass-a-cancelled-task-s-blockers-on-to-the-tasks-i.md): Pass a cancelled task's blockers on to the tasks it blocked

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
