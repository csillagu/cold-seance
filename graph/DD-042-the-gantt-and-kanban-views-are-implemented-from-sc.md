---
certainty: verified
evidence: design session 2026-11-02; design session 2026-11-03
---

# DD-042: The Gantt and Kanban views are implemented from scratch

## Decision

The Gantt and Kanban views are implemented from scratch, without an existing Gantt or Kanban library.

## Alternatives considered

An existing Gantt or Kanban library, versus building the views from scratch.

## Rationale

Existing Gantt and Kanban libraries are, in the owner's experience, usually poor, and one may turn out late in the work not to fit the tool's use. Building the views avoids finding that out at the last moment. As received, in the design session of 2026-11-03: "choose it because pre made libraries usually suck. And i dont wan to play around with those and find out in the last second that oopsie they dont fit my usecase."

## Trade-offs

Gives up an existing Gantt or Kanban library. The views, with their drawing, scrolling and editing, are built and maintained by the project, which costs effort a library would save.

## Risks

- Building the Gantt and Kanban takes longer than planned, since every interaction, such as dragging tasks or scrolling a long plan, is the project's own work.
- A Gantt drawn by the project's own code may slow down on plans with many tasks unless it is built for that from the start.

## Serves

This decision serves [SRC-009](SRC-009-kanban-view.md), [SRC-010](SRC-010-gantt-view.md), [SRC-197](SRC-197-the-frontend-is-written-in-typescript.md).

Origin: asked in the design session of 2026-11-02 which frontend framework to use and whether the Gantt and Kanban use an existing library or are built from scratch, the stakeholder answered: "ts something too, propose framework. We implement from scratch". Claude reads "from scratch" as applying to the Gantt and Kanban, the part of the question it answers. The reason was given in the design session of 2026-11-03; the trade-off naming the effort and the Risks section are Claude's.
