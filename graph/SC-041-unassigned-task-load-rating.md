---
certainty: assumed
effort: 3
---

# SC-041: Unassigned task load rating

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that rates a task with an eligibility expression but no assigned people red, amber or green, by checking each valid combination of eligible people in its eligibility tree ([DD-038](DD-038-eligibility-is-stored-as-a-tree.md)) against their load.

It is done when each such task is rated as FR-045 sets out: red when every valid combination of eligible people overloads someone, amber when some valid combinations do and others don't, and green when at least one valid combination fits; where amber and green both hold, the rating is amber ([SRC-201](SRC-201-amber-wins-when-some-combinations-fit-and-others-d.md)), so green only when no valid combination overloads anyone.

It delivers:

- [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md): Rate an eligible but unassigned task red, amber or green by load

Origin: split off from SC-006, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
