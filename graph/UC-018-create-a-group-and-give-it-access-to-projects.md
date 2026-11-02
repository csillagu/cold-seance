---
certainty: assumed
actor: Any user with an account
---

# UC-018: Create a group and give it access to projects

## Goal

Give a set of people access to several projects at once, instead of adding everyone to each project.

## Preconditions

- The actor has an account ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The actor creates a group ([SRC-141](SRC-141-anyone-logged-in-can-create-a-group.md)) and becomes its admin ([SRC-132](SRC-132-a-group-s-creator-becomes-its-admin.md)).
2. As group admin, they add people to the group, each with a role: read, contributor, write or admin ([SRC-144](SRC-144-the-group-admin-manages-the-group-s-members.md), [SRC-139](SRC-139-project-access-also-comes-through-groups.md), [SRC-137](SRC-137-a-group-can-give-the-contributor-role.md)).
3. Projects are added to the group: anyone can add a new project, and a project's admin can add an existing one ([SRC-143](SRC-143-who-can-add-a-project-to-a-group.md)).
4. Each member now holds their group role on every project in the group ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).

## Success criteria

- Group members can open the group's projects and its shared views, each with their group role or their direct role, whichever is higher ([SRC-139](SRC-139-project-access-also-comes-through-groups.md), [SRC-140](SRC-140-where-a-person-has-several-roles-on-a-project-the.md), [SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).

## Failure modes

- Someone who is not a project's admin cannot add that existing project to a group ([SRC-143](SRC-143-who-can-add-a-project-to-a-group.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
