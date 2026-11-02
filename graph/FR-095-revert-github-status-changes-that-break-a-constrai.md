---
certainty: assumed
---

# FR-095: Revert GitHub status changes that break a constraint

The system must revert a status change on GitHub that breaks a constraint: reset the start of a blocked task, reopen a blocked issue that was closed (or recreate it if it was deleted), and reopen a parent closed while its children are open ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)).

It serves [UC-008](UC-008-work-on-an-issue-from-github.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
