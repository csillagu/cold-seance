---
certainty: assumed
effort: 5
---

# SC-006: Daily person load aggregator

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that computes each person's load on each day: the load of every assigned, not cancelled task active that day, applied over the task's whole duration ([DD-009](DD-009-person-load-is-a-percentage-applied-over-the-task.md), [DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)) and summed across all projects, with capacity 0 on absence days. For each viewer it gives the exact tasks only for projects the viewer can read, and the rest only as a percentage ([DD-014](DD-014-load-visibility-across-projects.md)).

It delivers:

- [FR-034](FR-034-apply-a-task-s-load-to-each-assigned-person-over-i.md): Apply a task's load to each assigned person over its whole duration
- [FR-035](FR-035-count-only-assigned-people-toward-person-load.md): Count only assigned people toward person load
- [FR-036](FR-036-sum-a-person-s-daily-load-across-all-projects.md): Sum a person's daily load across all projects
- [FR-046](FR-046-show-load-from-unreadable-projects-only-as-a-perce.md): Show load from unreadable projects only as a percentage
- [FR-127](FR-127-free-a-cancelled-task-s-load.md): Free a cancelled task's load
- [FR-151](FR-151-treat-a-person-s-capacity-as-0-on-their-absence-da.md): Treat a person's capacity as 0 on their absence days

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
