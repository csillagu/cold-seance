---
certainty: assumed
actor: Group member
---

# UC-031: Leave a group

## Goal

Stop being a member of a group.

## Preconditions

- The actor is a member of the group ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).

## Steps

1. The actor leaves the group ([SRC-146](SRC-146-a-member-can-leave-a-group.md)).

## Success criteria

- The actor no longer holds the group role on the group's projects ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)).
- Any role they hold on those projects directly or through another group still applies ([SRC-139](SRC-139-project-access-also-comes-through-groups.md), [SRC-140](SRC-140-where-a-person-has-several-roles-on-a-project-the.md)).

## Failure modes

- The group's last admin cannot leave it ([SRC-145](SRC-145-a-group-s-last-admin-cannot-leave.md)).

Origin: composed by Claude from the items linked above, after the stakeholder answered questions on groups in the design session. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
