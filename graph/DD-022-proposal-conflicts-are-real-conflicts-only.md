---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-022: Proposal conflicts are real conflicts only

## Decision

A change in a proposal conflicts only if the same input on the same task was edited by someone else after the proposal was created, or the task was deleted. Conflicts are shown for the reviewer to resolve or drop.

## Alternatives considered

A conflict whenever a stored base value changes, versus only when the same input on the same task was edited.

## Rationale

Conflicting on base values would produce false conflicts.

## Trade-offs

Gives up conflict detection on base values.

## Serves

This decision serves [DD-020](DD-020-a-proposal-stores-only-planning-inputs.md).

Origin: part of the drafting agent's revised proposal flow; the stakeholder never explicitly confirmed it.
