---
certainty: assumed
actor: Repository admin
---

# UC-034: Approve adding a repository to a project

## Goal

Decide which projects may use a repository, so that nobody adds it to a project without its admin's say.

## Preconditions

- The actor is an admin of the repository in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
- A project's admin wants to add the repository to their project, to seed the project from it or to pull its issues ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md), [SRC-176](SRC-176-the-project-admin-sets-which-repositories-the-proj.md)). That project admin is not an admin of the repository; one who is adds it without a separate approval ([SRC-184](SRC-184-an-admin-of-both-the-repository-and-the-project-ad.md)).

## Steps

1. The actor is notified in the app that the project's admin wants to add the repository to the project ([SRC-186](SRC-186-repository-admins-get-an-in-app-notification-of-a-.md), [SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).
2. They approve adding the repository to the project ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).
3. The project can now be seeded from the repository and pull its issues ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md), [SRC-169](SRC-169-a-project-sets-which-repositories-it-pulls-issues.md)).

## Success criteria

- The repository is added to the project only after the actor's approval; the actor's approval alone is enough, even when the repository has other admins ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)).

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
