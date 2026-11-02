---
effort: 5
---

# SC-020: Saved view module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that stores named Kanban and Gantt views in a project, a group or personally, with the projects each may cover and its filter on task fields and on the person viewing it. It is done when a view of either kind can be saved under a name in each of the three places, each place limits the projects its views cover as FR-056 sets out, and a saved filter can name any task field and the person viewing.

It delivers:

- [FR-054](FR-054-let-users-save-named-kanban-and-gantt-views.md): Let users save named Kanban and Gantt views
- [FR-055](FR-055-keep-a-saved-view-in-a-project-a-group-or-personal.md): Keep a saved view in a project, a group or personally
- [FR-056](FR-056-limit-which-projects-a-saved-view-can-cover.md): Limit which projects a saved view can cover
- [FR-057](FR-057-let-a-saved-view-filter-on-any-task-field.md): Let a saved view filter on any task field
- [FR-058](FR-058-let-a-saved-view-filter-on-the-person-viewing-it.md): Let a saved view filter on the person viewing it

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11, and reworded after its quality review. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
