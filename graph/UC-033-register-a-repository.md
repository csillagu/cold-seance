---
certainty: assumed
actor: Any user with an account
---

# UC-033: Register a repository

## Goal

Bring a GitHub repository into the tool, so that projects can use it.

## Preconditions

- The actor has an account ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).
- The repository's admin on GitHub has installed the GitHub App on it ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)).
- Nobody has registered the repository in the tool yet ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).

## Steps

1. The actor chooses a repository the GitHub App has access to that is not yet registered ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).
2. They register it in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)).
3. They become the repository's admin in the tool ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).

## Success criteria

- The repository is registered in the tool, with the actor as its admin ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md), [SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).

## Failure modes

- A repository that is already registered cannot be registered again ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).
- Not stated: whether a repository admin can add other people as admins.

Origin: composed by Claude from the items linked above, for issue #7. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Awaits the stakeholder's confirmation.
