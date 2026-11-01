---
actor: Any user with an account
---

# UC-018: Create a group and give it access to projects

## Goal

Give a set of people access to several projects at once, instead of adding everyone to each project.

## Steps

1. The actor creates a group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).
2. The group admin adds people to the group, each with a read, write or admin role ([DD-028](DD-028-project-access-also-comes-through-groups.md)). Whether the group's creator becomes its admin is not stated in the input.
3. Projects are added to the group: anyone can add a new project, and a project's admin can add an existing one ([DD-028](DD-028-project-access-also-comes-through-groups.md)).
4. Each member now holds their group role on every project in the group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

## Success criteria

- Group members can open the group's projects and its shared views, each with their group role or their direct role, whichever is higher ([DD-028](DD-028-project-access-also-comes-through-groups.md), [SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).

## Failure modes

- Someone who is not a project's admin cannot add that existing project to a group ([DD-028](DD-028-project-access-also-comes-through-groups.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
