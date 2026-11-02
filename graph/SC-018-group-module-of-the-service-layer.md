# SC-018: Group module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps groups, their members and roles, and the projects in them: creation by anyone logged in, admins managing members, members leaving, deletion by system admins with the group's saved views.

It delivers:

- [FR-121](FR-121-let-anyone-logged-in-create-a-group.md): Let anyone logged in create a group
- [FR-122](FR-122-show-every-group-to-everyone.md): Show every group to everyone
- [FR-123](FR-123-let-anyone-add-a-new-project-to-a-group-and-only-i.md): Let anyone add a new project to a group, and only its admin an existing one
- [FR-124](FR-124-let-group-admins-manage-the-group-s-members.md): Let group admins manage the group's members
- [FR-125](FR-125-let-a-member-leave-a-group.md): Let a member leave a group
- [FR-126](FR-126-let-only-system-admins-delete-a-group.md): Let only system admins delete a group
- [FR-159](FR-159-make-a-group-s-creator-its-admin.md): Make a group's creator its admin
- [FR-160](FR-160-keep-at-least-one-admin-in-every-group.md): Keep at least one admin in every group
- [FR-161](FR-161-delete-a-group-s-saved-views-with-the-group.md): Delete a group's saved views with the group

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
