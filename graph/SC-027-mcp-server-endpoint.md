---
effort: 5
---

# SC-027: MCP server endpoint

The MCP server, served from the backend ([DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md)) on one endpoint over the Streamable HTTP transport ([DD-049](DD-049-the-mcp-server-uses-the-streamable-http-transport.md)), authenticated by personal access tokens ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)). Its tools read the plan and notifications and create proposals; it offers no other change to the plan. Like the REST API, it calls the one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)).

It delivers:

- [FR-067](FR-067-let-the-mcp-server-read-the-plan.md): Let the MCP server read the plan
- [FR-068](FR-068-let-the-mcp-server-change-the-plan-only-by-creatin.md): Let the MCP server change the plan only by creating proposals
- [FR-087](FR-087-let-the-rest-api-and-the-mcp-server-read-notificat.md): Let the REST API and the MCP server read notifications
- [FR-113](FR-113-apply-the-same-roles-to-api-tokens-and-mcp-server.md): Apply the same roles to API tokens and MCP server access
- [FR-115](FR-115-apply-the-same-rules-to-the-ui-the-rest-api-and-th.md): Apply the same rules to the UI, the REST API and the MCP server

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
