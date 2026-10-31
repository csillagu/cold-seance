---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-014: Load visibility across projects

## Decision

A person's load always shows their total across all projects. The viewer sees the exact tasks for projects they can read; load from other projects shows only as a percentage (e.g. "other projects: 60%").

## Alternatives considered

Showing exact task details, versus showing only "busy, 60%".

## Trade-offs

Gives up showing only a percentage everywhere.

## Serves

This decision serves [SRC-039](SRC-039-daily-load-per-person-is-summed-across-all-project.md).
