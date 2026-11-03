---
certainty: verified
---

# FR-167: Let anyone with an account register an unregistered repository and become its admin

The system must let anyone with an account register a repository that the tool can reach on GitHub, through a GitHub App installed on it or a personal access token that reaches it, and that is not yet registered, and make that person the repository's admin ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md), [SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md), [SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)). It must reject registering a repository that is already registered ([SRC-182](SRC-182-anyone-can-register-an-unregistered-repository-and.md)).

It serves [UC-033](UC-033-register-a-repository.md).

Origin: composed by Claude from the items linked above, for issue #7. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Reaching a repository through a personal access token was added by Claude for issue #37 (SRC-229); it awaits the owner's confirmation.
