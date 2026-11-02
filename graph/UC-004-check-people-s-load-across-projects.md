---
certainty: assumed
actor: Any user who can read the project
---

# UC-004: Check people's load across projects

## Goal

See who is busy, who has room and who is overloaded, day by day, across all projects.

## Preconditions

- The actor can read at least one project ([SRC-091](SRC-091-read-only-role.md)).

## Steps

1. The actor opens the person load view ([SRC-008](SRC-008-four-view-kinds-cover-manual-use.md), [SRC-011](SRC-011-person-load-view.md)).
2. For each person and day, they see the total load from all that person's assigned tasks active that day, across all projects ([SRC-039](SRC-039-daily-load-per-person-is-summed-across-all-project.md)), measured against the person's capacity ([SRC-041](SRC-041-each-person-has-a-capacity.md)). Days the person is absent count as capacity 0 ([SRC-042](SRC-042-absences-set-a-person-s-capacity-to-0.md)).
3. For projects the actor can read, they see the exact tasks behind the load; load from other projects shows only as a percentage, for example "other projects: 60%" ([DD-014](DD-014-load-visibility-across-projects.md)).
4. They spot days above capacity, shown in red, and tasks whose open eligibility choice could overload someone, shown in amber ([SRC-011](SRC-011-person-load-view.md), [SRC-035](SRC-035-red-amber-and-green-load-for-eligible-but-unassign.md)).

## Success criteria

- The actor can tell, for any person and day, whether that person is overloaded and which of their visible tasks cause it.

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
