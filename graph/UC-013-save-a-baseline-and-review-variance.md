---
actor: Project member
---

# UC-013: Save a baseline and review variance

## Goal

Compare how the project is going against the plan it was agreed on.

## Preconditions

- The project has planned dates.
- Which role may save a baseline is not stated in the input.

## Steps

1. The actor saves a baseline: a named snapshot of every task's planned start and finish in the project, such as "v1 approved" ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)).
2. Later, as work starts and finishes, actual dates are recorded ([SRC-055](SRC-055-actual-start-is-recorded-when-a-task-is-started.md), [SRC-056](SRC-056-actual-finish-is-recorded-when-a-task-is-finished.md)).
3. The actor opens the baseline variance view and selects a baseline ([SRC-012](SRC-012-baseline-variance-view.md), [SRC-053](SRC-053-planned-dates-are-compared-against-baselines-and-a.md)).
4. They read the variance per task and per milestone: actual dates, or the current plan where there are none yet, minus the selected baseline ([DD-037](DD-037-variance-is-computed-not-stored.md)).
5. Optionally, they show the baseline as bars on the Gantt ([SRC-010](SRC-010-gantt-view.md)).

## Success criteria

- The actor sees, for each task and milestone, how far it has drifted from the selected baseline. The variance view cannot be edited ([SRC-012](SRC-012-baseline-variance-view.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
