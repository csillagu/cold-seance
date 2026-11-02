# SC-007: Red flag detector

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that finds the conflicts shown in red ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)): a fixed-date milestone pushed past its date, a dependency on another project's milestone that lies after the task's start, a task whose assigned people are overloaded or absent within it, and an overload shared between projects. It clears a flag once its conflict is gone.

It delivers:

- [FR-013](FR-013-show-a-red-violation-when-a-fixed-date-milestone-i.md): Show a red violation when a fixed-date milestone is pushed
- [FR-019](FR-019-turn-a-cross-project-dependency-red-when-the-miles.md): Turn a cross-project dependency red when the milestone lies after the task's start
- [FR-020](FR-020-turn-a-task-red-when-its-assigned-people-cannot-do.md): Turn a task red when its assigned people cannot do it in its time
- [FR-021](FR-021-clear-a-red-flag-once-its-conflict-is-gone.md): Clear a red flag once its conflict is gone
- [FR-043](FR-043-show-a-shared-person-s-overload-in-red-to-every-pr.md): Show a shared person's overload in red to every project involved
- [FR-147](FR-147-show-a-cross-project-conflict-in-red-for-the-owner.md): Show a cross-project conflict in red for the owners to resolve

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
