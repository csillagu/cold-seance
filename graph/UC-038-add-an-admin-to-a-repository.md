---
certainty: assumed
actor: Repository admin
---

# UC-038: Add an admin to a repository

## Goal

Share the running of a repository with someone else.

## Preconditions

- The actor is an admin of the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
- The other person has an account ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The actor opens the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
2. They make the other person an admin of it ([SRC-187](SRC-187-a-repository-s-admins-can-add-other-admins.md)).

## Success criteria

- The other person is an admin of the repository, and can approve or reject projects' requests for it ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md), [SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
