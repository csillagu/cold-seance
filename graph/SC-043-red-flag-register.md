---
certainty: assumed
effort: 2
---

# SC-043: Red flag register

The store in the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) of the red flags currently raised. It records when each flag appears and clears each one once the conflict behind it is gone.

It delivers:

- [FR-021](FR-021-clear-a-red-flag-once-its-conflict-is-gone.md): Clear a red flag once its conflict is gone

Origin: split off from SC-007, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
