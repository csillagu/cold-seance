---
certainty: assumed
actor: Any user who can read the project
---

# UC-023: Review variance against a baseline

## Goal

See how far the project has drifted from a plan it saved earlier.

## Preconditions

- The project has at least one baseline ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)).
- As work started and finished, actual dates were recorded ([SRC-055](SRC-055-actual-start-is-recorded-when-a-task-is-started.md), [SRC-056](SRC-056-actual-finish-is-recorded-when-a-task-is-finished.md)).

## Steps

1. The actor opens the baseline variance view ([SRC-012](SRC-012-baseline-variance-view.md), [SRC-053](SRC-053-planned-dates-are-compared-against-baselines-and-a.md)).
2. They select a baseline.
3. They read the variance per task and per milestone: actual dates, or the current plan where there are none yet, minus the selected baseline ([DD-037](DD-037-variance-is-computed-not-stored.md)).
4. Optionally, they show the baseline as bars on the Gantt ([SRC-010](SRC-010-gantt-view.md)).

## Success criteria

- The actor sees, for each task and milestone, how far it has drifted from the selected baseline. The variance view cannot be edited ([SRC-012](SRC-012-baseline-variance-view.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
