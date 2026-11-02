---
certainty: assumed
---

# FR-045: Rate an eligible but unassigned task red, amber or green by load

While a task has an eligibility expression but no assigned people, the system must show it in the person load view in red when every valid combination of eligible people overloads someone, in amber when some valid combinations do and others don't, and in green when at least one valid combination fits ([SRC-035](SRC-035-red-amber-and-green-load-for-eligible-but-unassign.md), [SRC-011](SRC-011-person-load-view.md)).

It serves [UC-003](UC-003-assign-people-to-a-task.md) and [UC-004](UC-004-check-people-s-load-across-projects.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "ok".
