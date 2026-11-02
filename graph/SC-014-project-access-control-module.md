# SC-014: Project access control module

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that holds each person's role per project ([DD-034](DD-034-roles-are-assigned-per-project.md)), directly or through groups, decides what each role may read and change, filters every view to what its viewer can read, and tells someone explicitly when a project is not visible to them.

It delivers:

- [FR-017](FR-017-tell-someone-explicitly-when-a-project-is-not-visi.md): Tell someone explicitly when a project is not visible to them
- [FR-059](FR-059-show-in-a-view-only-the-tasks-its-viewer-can-read.md): Show in a view only the tasks its viewer can read
- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows
- [FR-105](FR-105-assign-roles-per-project.md): Assign roles per project
- [FR-106](FR-106-let-the-read-only-role-view-everything-and-edit-no.md): Let the read-only role view everything and edit nothing
- [FR-107](FR-107-let-a-contributor-set-only-the-status-of-tasks-ass.md): Let a contributor set only the status of tasks assigned to them
- [FR-108](FR-108-let-the-read-write-role-edit-the-plan-and-handle-p.md): Let the read-write role edit the plan and handle proposals
- [FR-109](FR-109-let-a-project-admin-manage-members-roles-repositor.md): Let a project admin manage members, roles, repositories and settings
- [FR-110](FR-110-keep-at-least-one-admin-on-every-project.md): Keep at least one admin on every project
- [FR-111](FR-111-give-group-members-their-group-role-on-every-proje.md): Give group members their group role on every project in the group
- [FR-112](FR-112-apply-the-highest-of-a-person-s-roles-on-a-project.md): Apply the highest of a person's roles on a project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
