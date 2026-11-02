---
certainty: assumed
actor: System admin
---

# UC-032: Delete a group

## Goal

Remove a group that is no longer needed.

## Preconditions

- The group exists ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).
- The actor is a system admin ([SRC-147](SRC-147-a-group-can-be-deleted.md), [SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The actor deletes the group ([SRC-147](SRC-147-a-group-can-be-deleted.md)).

## Success criteria

- The group's members no longer hold the group role on its projects ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).
- Any role they hold on those projects directly or through another group still applies ([SRC-139](SRC-139-project-access-also-comes-through-groups.md), [SRC-140](SRC-140-where-a-person-has-several-roles-on-a-project-the.md)).
- The group's saved views disappear ([SRC-147](SRC-147-a-group-can-be-deleted.md)).

## Failure modes

- Someone who is not a system admin, including the group's own admins, cannot delete the group ([SRC-147](SRC-147-a-group-can-be-deleted.md)).

Origin: composed by Claude from the items linked above, after the stakeholder answered questions on groups in the design session. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
