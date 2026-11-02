# DD-045: The frontend uses React, built with Vite

## Decision

The frontend is a React single-page application in TypeScript, built with Vite. The Gantt and Kanban are the project's own React components.

## Alternatives considered

React, Vue, Svelte, or Angular.

## Rationale

React has the largest pool of developers who could contribute to an open-source project, mature TypeScript support, and a component model that suits hand-built interactive views such as the Gantt and Kanban of [DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md). Vite is the usual build tool for a React application. Angular is the heaviest of the four and the least common in small open-source tools.

## Trade-offs

Gives up the smaller runtime and simpler reactivity of Svelte and Vue: a large Gantt in React needs care to avoid re-rendering every bar on each change.

## Serves

This decision serves [SRC-197](SRC-197-the-frontend-is-written-in-typescript.md), [DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md).

Origin: proposed by Claude at the stakeholder's request in the design session of 2026-11-02 ("ts something too, propose framework"). The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed".
