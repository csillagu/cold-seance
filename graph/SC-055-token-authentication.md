---
certainty: assumed
effort: 2
---

# SC-055: Token authentication

The step on each REST API and MCP request that resolves the token to its user, rejects it if it is revoked or expired or the account is no longer active, and applies the user's current roles ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)).

It delivers:

- [FR-113](FR-113-apply-the-same-roles-to-api-tokens-and-mcp-server.md): Apply the same roles to API tokens and MCP server access

Origin: split off from SC-016, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
