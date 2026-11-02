# SC-006: Person load calculator

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that computes each person's load per day: a task's person-load percentage, or an assignment's override, applied over the task's whole duration ([DD-009](DD-009-person-load-is-a-percentage-applied-over-the-task.md), [DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)), summed across all projects, against the person's capacity, with load from projects the viewer cannot read given only as a percentage ([DD-014](DD-014-load-visibility-across-projects.md)). It marks overloads and rates unassigned tasks red, amber or green; it never moves a task ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).

It delivers:

- [FR-032](FR-032-derive-a-task-s-default-person-load-percentage-fro.md): Derive a task's default person-load percentage from its AI share
- [FR-033](FR-033-let-a-single-assignment-override-the-task-s-person.md): Let a single assignment override the task's person-load percentage
- [FR-034](FR-034-apply-a-task-s-load-to-each-assigned-person-over-i.md): Apply a task's load to each assigned person over its whole duration
- [FR-035](FR-035-count-only-assigned-people-toward-person-load.md): Count only assigned people toward person load
- [FR-036](FR-036-sum-a-person-s-daily-load-across-all-projects.md): Sum a person's daily load across all projects
- [FR-042](FR-042-mark-a-person-overloaded-on-any-day-their-load-exc.md): Mark a person overloaded on any day their load exceeds their capacity
- [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md): Rate an eligible but unassigned task red, amber or green by load
- [FR-046](FR-046-show-load-from-unreadable-projects-only-as-a-perce.md): Show load from unreadable projects only as a percentage
- [FR-127](FR-127-free-a-cancelled-task-s-load.md): Free a cancelled task's load
- [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md): Let an AI-only task's load be any percentage, 1% by default
- [FR-151](FR-151-treat-a-person-s-capacity-as-0-on-their-absence-da.md): Treat a person's capacity as 0 on their absence days

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
