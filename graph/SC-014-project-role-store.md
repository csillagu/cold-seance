---
certainty: assumed
effort: 3
---

# SC-014: Project role store

The module of the service layer that holds each person's role in each project ([DD-034](DD-034-roles-are-assigned-per-project.md)), held directly or through groups, applies the highest where there are several, and rejects removing a project's last admin.

It delivers:

- [FR-105](FR-105-assign-roles-per-project.md): Assign roles per project
- [FR-110](FR-110-keep-at-least-one-admin-on-every-project.md): Keep at least one admin on every project
- [FR-111](FR-111-give-group-members-their-group-role-on-every-proje.md): Give group members their group role on every project in the group
- [FR-112](FR-112-apply-the-highest-of-a-person-s-roles-on-a-project.md): Apply the highest of a person's roles on a project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
