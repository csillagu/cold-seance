---
certainty: assumed
effort: 2
---

# SC-038: Task cancellation

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that cancels a task and makes each task it blocked blocked by whatever the cancelled task was blocked by.

It delivers:

- [FR-027](FR-027-let-a-task-be-cancelled-in-the-tool.md): Let a task be cancelled in the tool
- [FR-128](FR-128-pass-a-cancelled-task-s-blockers-on-to-the-tasks-i.md): Pass a cancelled task's blockers on to the tasks it blocked

Origin: split off from SC-003, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
