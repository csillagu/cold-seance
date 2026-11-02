---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-021: Proposal live preview against the current plan

## Decision

Opening a proposal applies its inputs to the current plan in memory, runs the scheduler, and shows the diff plus any new red flags. The reviewer always sees what approving would do now.

## Alternatives considered

A live preview against the current plan, versus freezing the project until the proposal is approved.

## Rationale

Freezing the project until the proposal is approved would be significantly harder, if not impossible, to implement.

## Serves

This decision serves [DD-020](DD-020-a-proposal-stores-only-planning-inputs.md), [SRC-080](SRC-080-a-person-with-write-access-edits-approves-or-rejec.md).
