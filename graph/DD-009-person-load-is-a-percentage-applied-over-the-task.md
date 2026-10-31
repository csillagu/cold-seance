---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-009: Person load is a percentage applied over the task's whole duration

## Decision

Each task has a person-load percentage that applies to every assigned person for the task's whole duration. AI work lowers the percentage, not the duration.

## Alternatives considered

Load as a percentage over the task's duration, versus effort hours.

## Rationale

The stakeholder preferred the person-load percentage.

## Trade-offs

Gives up effort-based load.

## Serves

This decision serves [SRC-100](SRC-100-two-50-ai-tasks-can-be-done-at-the-same-time.md), [SRC-038](SRC-038-person-load-by-task-type-and-ai-share.md).
