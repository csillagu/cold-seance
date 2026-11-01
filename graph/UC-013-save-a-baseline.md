---
certainty: assumed
actor: Project member with the read-write role
---

# UC-013: Save a baseline

## Goal

Keep a record of the plan as it stands now, to compare against later.

## Preconditions

- The actor has the read-write role in the project ([SRC-133](SRC-133-saving-a-baseline-needs-the-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The project has planned dates.

## Steps

1. The actor opens the project.
2. They save a baseline under a name, such as "v1 approved" or "v2 after re-plan" ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)).

## Success criteria

- The baseline holds every task's planned start and finish as they were when it was saved, and the project keeps it alongside its earlier baselines ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)).

## Failure modes

- A member without the read-write role cannot save a baseline ([SRC-133](SRC-133-saving-a-baseline-needs-the-read-write-role.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
