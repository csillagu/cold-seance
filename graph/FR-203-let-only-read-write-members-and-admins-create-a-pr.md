---
certainty: assumed
---

# FR-203: Let only read-write members and admins create a proposal

The system must refuse a proposal from anyone who does not hold the read-write or admin role in each project the proposal changes, and store nothing of it ([SRC-245](SRC-245-only-a-project-s-read-write-members-and-admins-cr.md), [DD-025](DD-025-a-proposal-may-span-several-projects-each-project.md)).

It serves [UC-011](UC-011-an-ai-agent-proposes-a-plan-change.md).

Origin: composed by Claude from the items linked above, for issue #114. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. That a proposal over several projects needs the role in each of them is Claude's reading of SRC-245 with DD-025; it awaits the owner's confirmation.
