# SC-026: REST API routes

The Fastify routes of the REST API ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)), with JSON schemas for their requests and responses, from which the API's OpenAPI description is generated. Each route authenticates the caller, translates the request and calls the one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)); no rule lives in a route.

It delivers:

- [FR-087](FR-087-let-the-rest-api-and-the-mcp-server-read-notificat.md): Let the REST API and the MCP server read notifications
- [FR-114](FR-114-give-the-rest-api-full-read-and-write-access-with.md): Give the REST API full read and write access with the UI's permission checks
- [FR-115](FR-115-apply-the-same-rules-to-the-ui-the-rest-api-and-th.md): Apply the same rules to the UI, the REST API and the MCP server

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
