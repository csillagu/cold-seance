---
certainty: verified
---

# FR-164: Log both channels for a change from an approved AI proposal

For each change an approved AI proposal applies, the system must record both channels in the audit log: the one through which the proposal was created, the MCP server or the REST API ([SRC-246](SRC-246-the-mcp-server-and-the-rest-api-create-proposals.md)), and the UI, through which it was approved ([SRC-173](SRC-173-a-change-from-an-approved-ai-proposal-is-logged-wi.md), [SRC-095](SRC-095-every-change-is-recorded-in-an-audit-log.md)).

It serves [UC-012](UC-012-review-and-approve-an-ai-proposal.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. The REST API was added as a channel a proposal can be created through for issue #114, from the owner's answer in the design session of 2026-11-06.
