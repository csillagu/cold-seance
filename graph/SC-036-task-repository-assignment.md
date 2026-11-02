---
certainty: assumed
effort: 1
---

# SC-036: Task repository assignment

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that sets the repository a task is assigned to, accepting only a repository its project pulls issues from.

It is done when a task can be assigned to any repository its project pulls issues from, and an assignment to any other repository is rejected.

It delivers:

- [FR-141](FR-141-let-a-task-be-assigned-to-a-repository.md): Let a task be assigned to a repository

Origin: split off from SC-001, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
