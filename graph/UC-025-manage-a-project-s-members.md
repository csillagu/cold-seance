---
certainty: assumed
actor: Project admin
---

# UC-025: Manage a project's members

## Goal

Give the right people the right access to a project.

## Preconditions

- The actor is the project's admin ([SRC-093](SRC-093-admin-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).

## Steps

1. The actor adds people to the project and gives each a role: read-only, contributor, read-write or admin ([SRC-091](SRC-091-read-only-role.md), [SRC-136](SRC-136-contributor-role.md), [SRC-092](SRC-092-read-write-role.md), [SRC-093](SRC-093-admin-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
2. They change or remove members' roles as needed ([SRC-093](SRC-093-admin-role.md)).
3. They may add the project to one or more groups, so that the groups' members get access with their group roles ([SRC-143](SRC-143-who-can-add-a-project-to-a-group.md), [SRC-139](SRC-139-project-access-also-comes-through-groups.md)).

## Success criteria

- Each member can do in the project what their role allows; where someone has a role directly and through a group, the higher one applies ([SRC-140](SRC-140-where-a-person-has-several-roles-on-a-project-the.md)).

## Failure modes

- The project's last admin cannot be removed ([SRC-135](SRC-135-a-project-s-last-admin-cannot-be-removed.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
