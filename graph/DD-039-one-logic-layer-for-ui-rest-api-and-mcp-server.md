---
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# DD-039: One logic layer for UI, REST API and MCP server

## Decision

The UI, REST API and MCP server all go through the same service layer and the same validation rules.

## Rationale

In the drafting agent's words: "no logic duplicated".

## Serves

This decision serves [SRC-077](SRC-077-rest-api-with-full-read-and-write-access.md), [SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md).

Origin: the drafting agent's addition. No alternative was discussed.
