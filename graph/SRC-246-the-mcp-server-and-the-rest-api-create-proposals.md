---
certainty: verified
source: design session
evidence: design session 2026-11-06
---

# SRC-246: The MCP server and the REST API create proposals; the UI does not

A proposal can be created through the MCP server and through the REST API, not through the UI.

As received, in the design session of 2026-11-06, in the work on the proposal store (SC-010, issue #114). Claude reported that the items name only the MCP server as a way to create a proposal, and asked whether the REST API should be able to create them too. The owner answered: "Mcp and rest api can create proposals, however mcp can only create proposals, no final things. Restapi can do final things." Asked what "final things" meant, the owner chose "Direct changes": through the REST API a token changes the live plan directly, as it can already, and also creates proposals, while the MCP server only creates proposals. Asked whether a person signed in to the browser UI should also be able to create a proposal, the owner chose "Only REST and MCP".

The rest of the answer restates what is already recorded: the MCP server writes only by creating proposals, and the REST API can change the plan directly.
