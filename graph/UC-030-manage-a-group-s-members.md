---
certainty: assumed
actor: Group admin
---

# UC-030: Manage a group's members

## Goal

Keep a group's membership and roles up to date, so the right people have the right access to all of the group's projects.

## Preconditions

- The actor is the group's admin ([SRC-132](SRC-132-a-group-s-creator-becomes-its-admin.md), [SRC-144](SRC-144-the-group-admin-manages-the-group-s-members.md)).

## Steps

1. The actor adds people to the group, each with a role: read, contributor, write or admin ([SRC-144](SRC-144-the-group-admin-manages-the-group-s-members.md), [SRC-139](SRC-139-project-access-also-comes-through-groups.md), [SRC-137](SRC-137-a-group-can-give-the-contributor-role.md)).
2. They change members' roles or remove members as needed ([SRC-144](SRC-144-the-group-admin-manages-the-group-s-members.md)).

## Success criteria

- Each member holds their group role on every project in the group ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).
- Where a member also has a role on a project directly or through another group, the highest applies ([SRC-140](SRC-140-where-a-person-has-several-roles-on-a-project-the.md)).

Origin: composed by Claude from the items linked above, after the stakeholder asked for use cases covering the group rules. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
