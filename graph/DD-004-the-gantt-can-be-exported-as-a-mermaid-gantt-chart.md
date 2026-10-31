---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-004: The Gantt can be exported as a Mermaid gantt chart

## Decision

The Gantt can be exported as a Mermaid gantt chart, which renders in GitHub markdown. The export carries tasks, dates, dependencies and milestones; load and red flags are not part of it.

## Alternatives considered

PDF or image export, versus a Mermaid chart.

## Trade-offs

Gives up PDF and image export.

## Serves

This decision serves [SRC-010](SRC-010-gantt-view.md).

Origin: the stakeholder gave no reason ("gant export -> mermaid?"). That it renders in GitHub was added by the drafting agent afterwards.
