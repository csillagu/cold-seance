---
certainty: assumed
actor: Repository admin
---

# UC-037: Withdraw a project's approval for a repository

## Goal

Take back a repository from a project that was allowed to use it.

## Preconditions

- The actor is an admin of the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
- One of the repository's admins approved adding it to the project earlier ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).

## Steps

1. The actor withdraws the approval given to the project ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

## Success criteria

- Not stated: what changes for the project once the approval is withdrawn, including what happens to its tasks from the repository ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
