---
certainty: verified
actor: Repository admin
---

# UC-036: Reject a project's request for a repository

## Goal

Keep a repository out of a project that should not use it.

## Preconditions

- The actor is an admin of the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
- A project's admin has asked to add the repository to their project ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).

## Steps

1. The actor is notified in the app that the project wants the repository ([SRC-186](SRC-186-repository-admins-get-an-in-app-notification-of-a-.md)).
2. They reject the request ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

## Success criteria

- The repository is not added to the project: the project is neither seeded from it nor pulls its issues ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md), [SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item.
