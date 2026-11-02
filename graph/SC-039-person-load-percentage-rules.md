---
certainty: assumed
effort: 2
---

# SC-039: Person-load percentage rules

The rules in the service layer that give a task its person-load percentage: 100% minus its AI share by default ([DD-009](DD-009-person-load-is-a-percentage-applied-over-the-task.md)), an override for one assignment ([DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)), and any value for an AI-only task.

It delivers:

- [FR-032](FR-032-derive-a-task-s-default-person-load-percentage-fro.md): Derive a task's default person-load percentage from its AI share
- [FR-033](FR-033-let-a-single-assignment-override-the-task-s-person.md): Let a single assignment override the task's person-load percentage
- [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md): Let an AI-only task's load be any percentage, 1% by default

Origin: split off from SC-006, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
