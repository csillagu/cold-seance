---
certainty: assumed
---

# FR-014: Reject a blocked-by relation that would create a cycle

The system must reject, when it is saved, a blocked-by relation that would create a cycle in the blocking relations ([SRC-025](SRC-025-cycles-in-blocking-relations-are-rejected-on-write.md)).

It serves [UC-021](UC-021-link-tasks-with-constraints.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
