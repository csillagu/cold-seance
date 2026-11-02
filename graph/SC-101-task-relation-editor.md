---
certainty: assumed
effort: 3
---

# SC-101: Task relation editor

The editor in which a task's parent, subtasks and blockers are set, including a milestone of another project, with the reason shown when a relation is rejected. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It delivers:

- [FR-014](FR-014-reject-a-blocked-by-relation-that-would-create-a-c.md): Reject a blocked-by relation that would create a cycle
- [FR-015](FR-015-record-a-task-blocked-by-another-project-s-milesto.md): Record a task blocked by another project's milestone
- [FR-016](FR-016-require-read-access-to-depend-on-another-project-s.md): Require read access to depend on another project's milestone

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
