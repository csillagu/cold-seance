---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-017: An issue closed as not planned is reopened; tasks are cancelled only in the tool

## Decision

An issue closed as "not planned" on GitHub is reopened by the tool. Tasks can only be cancelled in the tool.

## Alternatives considered

Cancelling the task, versus keeping it.

## Rationale

A random user on GitHub should not be able to cancel tasks in a plan.

## Trade-offs

Gives up cancelling from GitHub.

## Serves

This decision serves [SRC-002](SRC-002-the-tool-is-the-single-source-of-truth-for-plannin.md).
