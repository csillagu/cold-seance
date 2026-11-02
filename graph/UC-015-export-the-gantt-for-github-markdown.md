---
certainty: assumed
actor: Any user who can read the project
---

# UC-015: Export the Gantt for GitHub markdown

## Goal

Share the schedule in a place where people read GitHub markdown.

## Preconditions

- The actor can read the project ([SRC-091](SRC-091-read-only-role.md)).

## Steps

1. The actor opens a Gantt ([SRC-010](SRC-010-gantt-view.md)).
2. They export it as a chart that renders in GitHub markdown ([DD-004](DD-004-the-gantt-can-be-exported-as-a-mermaid-gantt-chart.md)).
3. They paste it where they want it to show, such as a README or an issue.

## Success criteria

- The chart shows the tasks, dates, dependencies and milestones; it does not show load or red flags ([DD-004](DD-004-the-gantt-can-be-exported-as-a-mermaid-gantt-chart.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
