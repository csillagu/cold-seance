---
certainty: assumed
effort: 3
---

# SC-099: Eligibility expression editor

The editor in which a task's eligibility is built as an AND/OR expression over people, up to two levels deep ([DD-038](DD-038-eligibility-is-stored-as-a-tree.md)). It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when expressions such as A AND (B OR C OR D) and (A AND B) OR C can be built and saved, and an expression nested deeper than two levels cannot, and when each person in the expression who cannot read the task's project is marked.

It delivers:

- [FR-028](FR-028-store-eligibility-as-an-and-or-expression-up-to-tw.md): Store eligibility as an AND/OR expression up to two levels deep
- [FR-197](FR-197-reject-an-eligibility-expression-nested-deeper-tha.md): Reject an eligibility expression nested deeper than two levels
- [FR-199](FR-199-mark-the-people-on-a-task-who-cannot-read-its-proj.md): Mark the people on a task who cannot read its project: in the eligibility expression

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it. FR-197 and FR-199 were added for issue #77; which SC marks the people of FR-199 is Claude's choice, the owner having answered "be creative".
