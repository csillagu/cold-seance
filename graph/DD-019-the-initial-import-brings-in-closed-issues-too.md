---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-019: The initial import brings in closed issues too

## Decision

The initial import brings in closed issues as well as open ones. Closed issues come in as done, with their actual finish taken from the GitHub Projects closing-date field.

## Alternatives considered

Importing open issues only, versus closed ones too.

## Trade-offs

Gives up importing open issues only.

## Serves

This decision serves [SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md).
