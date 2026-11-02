---
evidence: design session 2026-11-02
---

# DD-043: The MCP server is part of the backend

## Decision

The MCP server runs as part of the backend, not as a separate process.

## Alternatives considered

A separate process, versus part of the backend.

## Rationale

Not stated.

## Trade-offs

Gives up running the MCP server as a separate process.

## Serves

This decision serves [SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md), [DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md).

Origin: asked in the design session of 2026-11-02 whether the MCP server is a separate process or part of the backend, and which transport it uses, the stakeholder answered: "part". The transport was not answered; Claude's proposal for it is DD-049.
