# DD-049: The MCP server uses the Streamable HTTP transport

## Decision

The MCP server is served over the MCP specification's Streamable HTTP transport, on an endpoint of the backend, and each request is authenticated with an API token ([DD-048](DD-048-api-access-uses-personal-access-tokens.md)).

## Alternatives considered

The stdio transport, the older HTTP with Server-Sent Events transport, or Streamable HTTP.

## Rationale

With stdio, the AI client starts the server as a local process beside itself, which does not fit an MCP server that is part of a shared, self-hosted backend ([DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md)). The specification has replaced HTTP with Server-Sent Events by Streamable HTTP.

## Trade-offs

Clients that only speak stdio need a local bridge. The endpoint is reachable over the network, so it relies on token authentication and on the deployment providing TLS.

## Risks

- The endpoint is reachable over the network. Without TLS from the deployment, tokens travel in clear text.
- AI agents can read heavily or create many proposals quickly, which loads the backend unless requests are limited.
- The MCP specification is still changing. A change to its transport or authentication may need rework.

## Serves

This decision serves [SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md), [DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md), [DD-048](DD-048-api-access-uses-personal-access-tokens.md).

Origin: the stakeholder answered "part" to whether the MCP server is a separate process or part of the backend, and left its transport open; Claude proposes this transport in the design session of 2026-11-02, with the other technical choices the stakeholder asked it to propose. The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and awaits the stakeholder's confirmation.
