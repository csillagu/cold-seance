# SC-057: Group membership

The functions of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) with which a group's admins add members with a role, change their roles and remove them, and a member leaves, never leaving the group without an admin.

It delivers:

- [FR-124](FR-124-let-group-admins-manage-the-group-s-members.md): Let group admins manage the group's members
- [FR-125](FR-125-let-a-member-leave-a-group.md): Let a member leave a group
- [FR-160](FR-160-keep-at-least-one-admin-in-every-group.md): Keep at least one admin in every group

Origin: split off from SC-018, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
