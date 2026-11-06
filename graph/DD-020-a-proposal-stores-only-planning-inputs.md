---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-020: A proposal stores only planning inputs

## Decision

A proposal stores only planning inputs, never computed dates: new tasks, durations, effort, AI share, constraints, fixed dates, eligibility and assignments. Dates the scheduler derives are not stored in it, and its preview is always recomputed against the live plan, so most plan changes don't make it stale.

## Alternatives considered

Storing changes with their base values, including computed dates (e.g. "finish: 12 Nov → 19 Nov"), versus storing inputs only.

## Rationale

Storing computed dates would cause false conflicts everywhere, because automatic rescheduling changes them.

## Trade-offs

Gives up storing computed values.

## Serves

This decision serves [SRC-079](SRC-079-a-proposal-is-a-set-of-changes-against-the-current.md), [SRC-248](SRC-248-a-proposal-never-stores-a-date-the-scheduler-der.md).

Origin: the stakeholder asked the drafting agent "what do you propose?" and doubted its first version ("rebasing, I am not sure if this one will be successful tbh"). The agent revised it into this one, and the stakeholder never explicitly confirmed the revision. In the design session of 2026-11-06 the owner confirmed that it still holds now that a proposal can change anything in a project's plan ([SRC-248](SRC-248-a-proposal-never-stores-a-date-the-scheduler-der.md)); the list of inputs above is no longer the whole of what a proposal can change ([SRC-247](SRC-247-a-proposal-can-change-anything-in-a-project-s-pla.md)).
