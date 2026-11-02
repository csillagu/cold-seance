# DD-046: Scheduling is the project's own code in the service layer

## Decision

The scheduler is the project's own TypeScript code in the service layer. It works through the tasks of a project in the order their dependencies impose and computes their dates in memory, without an external solver. The same code computes the live plan and a proposal's preview.

## Alternatives considered

A general constraint-solver library, the scheduling engine of a commercial Gantt library, or the project's own code.

## Rationale

The rules are few and fixed: no lag on dependencies ([DD-030](DD-030-dependencies-have-no-lag.md)), parents spanning their children, milestones on fixed dates, forbidden days, and no automatic leveling ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)). One pass along the dependency order covers them without an optimiser. A proposal's preview ([DD-021](DD-021-proposal-live-preview-against-the-current-plan.md)) runs the scheduler on an in-memory copy of the plan, which is simplest when the scheduler is plain code in the same layer. Commercial Gantt engines conflict with building the Gantt from scratch ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md)) and with the open-source license ([SRC-198](SRC-198-everything-in-the-tool-is-open-source-under-the-ap.md)).

## Trade-offs

The project owns the scheduler's correctness and must test it thoroughly. Adding leveling or optimisation later would be new work, not configuration.

## Serves

This decision serves [SRC-003](SRC-003-constraints-reschedule-dates-automatically-within.md), [SRC-019](SRC-019-all-three-constraint-types-are-enforced-in-the-too.md), [DD-021](DD-021-proposal-live-preview-against-the-current-plan.md), [DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md).

Origin: proposed by Claude at the stakeholder's request in the design session of 2026-11-02 ("5-7 propose"). The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed".
