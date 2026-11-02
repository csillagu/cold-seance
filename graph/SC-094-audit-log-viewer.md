---
certainty: assumed
effort: 3
---

# SC-094: Audit log viewer

The screen that shows the audit log, the whole of it to system admins and a project's part to its admins and read-write members. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a system admin sees every entry, a project's admin or read-write member sees only the entries of their own projects, each entry shows who made the change, when and through which channel, and anyone else is refused.

It delivers:

- [FR-116](FR-116-record-every-change-in-an-audit-log.md): Record every change in an audit log
- [FR-138](FR-138-let-system-admins-read-the-whole-audit-log-and-pro.md): Let system admins read the whole audit log, and project admins and writers their projects' part

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
