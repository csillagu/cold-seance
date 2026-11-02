---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-038: Eligibility is stored as a tree

## Decision

The eligibility expression is stored as a tree, e.g. `{"all": ["A", {"any": ["B", "C", "D"]}]}`.

## Serves

This decision serves [SRC-030](SRC-030-eligibility-is-an-and-or-expression-over-people-up.md).

Origin: the drafting agent's proposal; no alternative came up.
