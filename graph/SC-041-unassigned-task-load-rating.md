# SC-041: Unassigned task load rating

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that rates a task with an eligibility expression but no assigned people red, amber or green, by checking each valid combination of eligible people in its eligibility tree ([DD-038](DD-038-eligibility-is-stored-as-a-tree.md)) against their load.

It delivers:

- [FR-045](FR-045-rate-an-eligible-but-unassigned-task-red-amber-or.md): Rate an eligible but unassigned task red, amber or green by load

Origin: split off from SC-006, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
