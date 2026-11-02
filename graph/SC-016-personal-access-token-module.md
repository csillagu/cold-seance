# SC-016: Personal access token module

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that lets each user create, list and revoke their own API tokens, stores each only as a hash with an optional expiry, and resolves a token on each request to its user, with that user's current roles ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)). The REST API and the MCP server both use it.

It delivers:

- [FR-113](FR-113-apply-the-same-roles-to-api-tokens-and-mcp-server.md): Apply the same roles to API tokens and MCP server access

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
