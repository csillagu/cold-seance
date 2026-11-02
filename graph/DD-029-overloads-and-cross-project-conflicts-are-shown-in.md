---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-029: Overloads and cross-project conflicts are shown in red, never leveled automatically

## Decision

When something crossing a project boundary conflicts, it is shown as a red violation for the owners to resolve. Overloads are detected and shown, never fixed automatically across projects: a person above their capacity on a day is overloaded and shown in red, and nothing is moved automatically.

## Alternatives considered

"automatic leveling of ALL projects", versus "red on over constraining someone".

## Rationale

As received: "what I really dont want is automatic leveling of ALL projects", because "That would mean changing someone else project without their approval".

## Trade-offs

Gives up automatic leveling.

## Serves

This decision serves [SRC-004](SRC-004-cross-project-effects-never-change-another-project.md), [SRC-041](SRC-041-each-person-has-a-capacity.md).
