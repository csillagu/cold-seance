---
certainty: assumed
effort: 3
---

# SC-092: Saved view filter builder

The part of the saved view editor in which a user builds a view's filter on any task field and on the person viewing it. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a filter can be built on any task field and on the person viewing the view, as in "MY kanban", for views kept in a project, a group or personally.

It delivers:

- [FR-057](FR-057-let-a-saved-view-filter-on-any-task-field.md): Let a saved view filter on any task field
- [FR-058](FR-058-let-a-saved-view-filter-on-the-person-viewing-it.md): Let a saved view filter on the person viewing it

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
