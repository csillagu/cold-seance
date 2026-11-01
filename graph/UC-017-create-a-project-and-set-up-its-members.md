---
actor: Any user with an account
---

# UC-017: Create a project and set up its members

## Goal

Start a new project and give the right people access to it.

## Preconditions

- The actor has an account ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The actor creates a project and becomes its admin ([DD-035](DD-035-anyone-with-an-account-can-create-a-project-and-be.md)).
2. They add members and give each a role in the project: read-only, read-write or admin ([SRC-091](SRC-091-read-only-role.md), [SRC-092](SRC-092-read-write-role.md), [SRC-093](SRC-093-admin-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
3. They may add the project to one or more groups, so that the groups' members get access ([DD-028](DD-028-project-access-also-comes-through-groups.md)).
4. They set its repository mapping and settings ([SRC-093](SRC-093-admin-role.md)).

## Success criteria

- Each member can do in the project what their role allows; where someone has a role directly and through a group, the higher one applies ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

## Failure modes

- Only the project's admin can add an existing project to a group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
