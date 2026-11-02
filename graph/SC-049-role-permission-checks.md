# SC-049: Role permission checks

The checks in the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that decide, from a person's role in a project ([DD-034](DD-034-roles-are-assigned-per-project.md)), which reads and changes they may make there: read-only, contributor, read-write and admin, and the same per card in a view over several projects.

It delivers:

- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows
- [FR-106](FR-106-let-the-read-only-role-view-everything-and-edit-no.md): Let the read-only role view everything and edit nothing
- [FR-107](FR-107-let-a-contributor-set-only-the-status-of-tasks-ass.md): Let a contributor set only the status of tasks assigned to them
- [FR-108](FR-108-let-the-read-write-role-edit-the-plan-and-handle-p.md): Let the read-write role edit the plan and handle proposals
- [FR-109](FR-109-let-a-project-admin-manage-members-roles-repositor.md): Let a project admin manage members, roles, repositories and settings

Origin: split off from SC-014, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
