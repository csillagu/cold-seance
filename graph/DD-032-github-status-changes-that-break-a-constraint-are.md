---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-032: GitHub status changes that break a constraint are reverted

## Decision

GitHub must not allow a status change that breaks a constraint; the tool reverts it. A blocked issue that gets closed is reopened (or recreated if deleted), a parent closed with open children is reopened, and a start on a blocked task is reset.

## Alternatives considered

Reverting the GitHub change, versus accepting it and flagging it red.

## Trade-offs

Gives up accepting the change and flagging it red.

## Serves

This decision serves [SRC-019](SRC-019-all-three-constraint-types-are-enforced-in-the-too.md), [SRC-020](SRC-020-subtask-parent-child-constraint.md), [SRC-021](SRC-021-blocked-by-blocking-constraint.md).

Origin: as received, "tool reopens/recreates it". No reason was given.
