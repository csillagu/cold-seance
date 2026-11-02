---
certainty: assumed
---

# FR-005: Reschedule blocked tasks within a project when their blocker moves

Within a project, the system must reschedule a task blocked by another task whenever the blocker's dates change ([SRC-003](SRC-003-constraints-reschedule-dates-automatically-within.md), [SRC-021](SRC-021-blocked-by-blocking-constraint.md)), so that it starts on its next working day after the blocker finishes, with no lag ([DD-030](DD-030-dependencies-have-no-lag.md), [SRC-121](SRC-121-scheduling-skips-non-working-days.md)).

It serves [UC-002](UC-002-reschedule-work-in-a-project.md) and [UC-021](UC-021-link-tasks-with-constraints.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
