---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-030: Dependencies have no lag

## Decision

Dependencies have no lag: a blocked task can start the next working day after its blocker finishes.

## Alternatives considered

An optional lag ("yes, optional, default 0", the drafting agent's suggestion), versus no lag.

## Rationale

The stakeholder sees no need for a lag. Asked for the reason, on 2026-11-01: "no need?"

## Trade-offs

Gives up an optional lag.

## Serves

This decision serves [SRC-021](SRC-021-blocked-by-blocking-constraint.md), [SRC-121](SRC-121-scheduling-skips-non-working-days.md).

Origin: the stakeholder answered "2 no" when the requirements were drafted.
