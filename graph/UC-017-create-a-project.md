---
certainty: assumed
actor: Any user with an account
---

# UC-017: Create a project

## Goal

Start a new project.

## Preconditions

- The actor has an account ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The actor creates a project ([DD-035](DD-035-anyone-with-an-account-can-create-a-project-and-be.md)).
2. They may add the new project to one or more groups, choosing from all groups, since every group is visible to everyone ([SRC-143](SRC-143-who-can-add-a-project-to-a-group.md), [SRC-142](SRC-142-every-group-is-visible-to-everyone.md)).

## Success criteria

- The project exists, and the actor is its admin ([DD-035](DD-035-anyone-with-an-account-can-create-a-project-and-be.md), [SRC-093](SRC-093-admin-role.md)).
- Members of any group the project was added to hold their group role on it ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
