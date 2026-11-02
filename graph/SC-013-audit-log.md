# SC-013: Audit log

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that records every change with who made it, when, and through which channel, and serves the log only to those allowed to read it. Because every channel goes through the one service layer, every change passes it.

It delivers:

- [FR-116](FR-116-record-every-change-in-an-audit-log.md): Record every change in an audit log
- [FR-138](FR-138-let-system-admins-read-the-whole-audit-log-and-pro.md): Let system admins read the whole audit log, and project admins and writers their projects' part
- [FR-139](FR-139-record-the-approver-as-the-author-of-an-approved-a.md): Record the approver as the author of an approved AI proposal's changes
- [FR-164](FR-164-log-both-channels-for-a-change-from-an-approved-ai.md): Log both channels for a change from an approved AI proposal

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
