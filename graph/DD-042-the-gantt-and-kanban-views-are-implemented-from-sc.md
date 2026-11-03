---
certainty: verified
evidence: design session 2026-11-02
---

# DD-042: The Gantt and Kanban views are implemented from scratch

## Decision

The Gantt and Kanban views are implemented from scratch, without an existing Gantt or Kanban library.

## Alternatives considered

An existing Gantt or Kanban library, versus building the views from scratch.

## Rationale

The stakeholder chose it without giving a reason: "We implement from scratch".

## Trade-offs

Gives up an existing Gantt or Kanban library.

## Serves

This decision serves [SRC-009](SRC-009-kanban-view.md), [SRC-010](SRC-010-gantt-view.md), [SRC-197](SRC-197-the-frontend-is-written-in-typescript.md).

Origin: asked in the design session of 2026-11-02 which frontend framework to use and whether the Gantt and Kanban use an existing library or are built from scratch, the stakeholder answered: "ts something too, propose framework. We implement from scratch". Claude reads "from scratch" as applying to the Gantt and Kanban, the part of the question it answers.
