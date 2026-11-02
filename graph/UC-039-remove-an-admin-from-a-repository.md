---
certainty: assumed
actor: Repository admin
---

# UC-039: Remove an admin from a repository

## Goal

Take away the running of a repository from someone, the actor included, who should no longer have it.

## Preconditions

- The actor is an admin of the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).

## Steps

1. The actor opens the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
2. They remove an admin from it; this may be themselves, stepping down ([SRC-189](SRC-189-a-repository-s-admins-can-remove-other-admins-or-s.md)).

## Success criteria

- The person removed is no longer an admin of the repository, and can no longer approve or reject projects' requests for it ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md), [SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

## Failure modes

- The repository's last admin cannot be removed or step down ([SRC-188](SRC-188-a-repository-cannot-be-left-without-an-admin.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
