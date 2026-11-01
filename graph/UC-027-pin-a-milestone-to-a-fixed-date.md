---
actor: Project member with the read-write role
---

# UC-027: Pin a milestone to a fixed date

## Goal

Fix a milestone to a date that scheduling must not move.

## Preconditions

- The actor has the read-write role in the project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The milestone exists in the project.

## Steps

1. The actor opens the milestone on the project's Gantt ([SRC-010](SRC-010-gantt-view.md), [SRC-113](SRC-113-everything-shown-in-a-view-is-editable-there-unles.md)).
2. They pin it to a fixed date ([SRC-022](SRC-022-fixed-date-milestones-constraint.md)).
3. They save.

## Success criteria

- Scheduling never moves the milestone from its date ([SRC-022](SRC-022-fixed-date-milestones-constraint.md)).

## Failure modes

- If work it depends on already pushes it past the date, the milestone stays on its date and the violation shows in red on the Gantt ([SRC-022](SRC-022-fixed-date-milestones-constraint.md), [SRC-010](SRC-010-gantt-view.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
