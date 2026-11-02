---
certainty: assumed
actor: System admin
---

# UC-035: Change a repository's admins

## Goal

Put a repository in the right hands, for example when someone with no business owning it registered it first.

## Preconditions

- The actor is a system admin ([SRC-183](SRC-183-system-admins-can-change-a-repository-s-admins.md)).
- The repository is registered in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).

## Steps

1. The actor opens the registered repository ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
2. They change who its admins are ([SRC-183](SRC-183-system-admins-can-change-a-repository-s-admins.md)).

## Success criteria

- The repository's admins are the people the actor chose; only they can now approve adding it to a project ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).

## Failure modes

- The actor cannot leave the repository without an admin ([SRC-188](SRC-188-a-repository-cannot-be-left-without-an-admin.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
