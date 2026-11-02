---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-173: A change from an approved AI proposal is logged with both channels

For a change that an approved AI proposal applies, the audit log ([SRC-095](SRC-095-every-change-is-recorded-in-an-audit-log.md)) records both channels: the MCP server, through which the AI created the proposal ([SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md)), and the UI, through which a person approved it ([SRC-080](SRC-080-a-person-with-write-access-edits-approves-or-rejec.md)).

As received, asked which channel the audit log should record for such a change, the MCP server, the UI or something else: "Both".
