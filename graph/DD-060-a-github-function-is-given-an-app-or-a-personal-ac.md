---
certainty: verified
---

# DD-060: A GitHub function is given an App or a personal access token

## Decision

For each of the tool's functions on GitHub, reading issues, writing to issues and the Projects status field ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)), the configuration ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)) gives either a GitHub App, as [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md) describes, or a personal access token ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). One token may be given for every function, or a separate one for each, and functions given a token may sit beside functions given an App. Mixing is by function only: a function uses its App or its token on every repository ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). For a function given a token, the tool calls GitHub with that token, as the GitHub account that owns it, on the repositories the token can reach. A function given both an App and a token, or neither, stops the tool at start, naming the function, so an installation without them cannot be deployed ([SRC-233](SRC-233-the-tool-is-not-deployed-without-an-app-or-a-token.md)).

The token is created on GitHub by the account that owns it, which may be any account ([SRC-231](SRC-231-a-personal-access-token-may-belong-to-anyone.md)); the tool does not create it. The tool uses the token as given and does not tell the kinds of GitHub token apart. A token may be limited to the permissions its function needs and to selected repositories ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)); the tool then reaches only those repositories through it.

When GitHub refuses a token as expired or revoked, the tool notifies every system admin in the app ([SRC-232](SRC-232-the-system-admin-is-notified-of-an-expired-or-revo.md), [DD-003](DD-003-notifications-are-in-app-only.md)), naming the function whose token it is. The function stops working until a new token is configured and the tool restarted.

Webhooks from Apps stay as [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md) describes. Beside them, the tool accepts the webhooks set up on a repository or an organization on GitHub ([SRC-230](SRC-230-repository-and-organization-webhooks-are-accepted-.md)), by whoever administers that repository or organization, pointed at the tool's webhook endpoint with a webhook secret of their choosing. The configuration holds one webhook secret for all of them, and the tool checks each such delivery against it. With no such secret configured, the tool accepts none of them, and changes reach it through the webhooks of its Apps, if any send them, and through the hourly re-check ([SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md)). The owner asked for these webhooks for an installation that uses no App; accepting them also beside Apps, whenever their secret is configured, was Claude's proposal, which the owner confirmed.

## Alternatives considered

- Apps only, as before: ruled out by the owner's request, since some companies do not allow Apps ([SRC-228](SRC-228-some-companies-do-not-allow-github-apps.md)).
- Tokens only: ruled out by the owner, "Both should be an option".
- One kind for the whole installation, all Apps or all tokens: ruled out by the owner, "the two can be mixed".
- Mixing by repository, one function using an App on some repositories and a token on others: ruled out by the owner, "No per-repo mixing".
- For a function given both an App and a token: preferring one of them, rather than refusing to start.
- For repository and organization webhooks: a secret for each repository or organization, rather than one for all; or accepting them only when no function uses an App.

## Rationale

The owner asked for tokens beside Apps, as granular as Apps and mixable with them by function ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). Choosing per function keeps the shape that Apps already have ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)): each function names what the tool calls GitHub as for it. Refusing to start on a function given both, or neither, follows the configuration's rule of refusing a missing setting ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)), avoids a silent choice between the two, and keeps an installation without them from being deployed ([SRC-233](SRC-233-the-tool-is-not-deployed-without-an-app-or-a-token.md)). One secret for repository and organization webhooks keeps the configuration to one setting however many repositories send them. The owner chose notifying the system admin for an unusable token ([SRC-232](SRC-232-the-system-admin-is-notified-of-an-expired-or-revo.md)), and notifications are in the app only ([DD-003](DD-003-notifications-are-in-app-only.md)).

## Trade-offs

- What the tool does through a token appears on GitHub as the token's account, not as an App: the issues it creates, the comments that explain a revert ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)) and the status changes it makes carry that account's name.
- A token reaches what its account can reach, within the limits set when the token is created, rather than the repositories each repository's admin installed an App on ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)). Which repositories the tool can register then depends on whoever created the token.
- A token may expire or be revoked, and the tool cannot renew it: the function stops until a system admin's notification leads to a new token being configured and the tool restarted.
- With one secret for every repository and organization webhook, anyone who sets one up must be given that secret, and changing it means changing it on every one of them.

## Risks

- Anyone who can read the configuration, or the host it is on, gets the tokens and the webhook secret, and can act as the tokens' accounts on everything the tokens reach.
- A token may belong to a person who also works on GitHub ([SRC-231](SRC-231-a-personal-access-token-may-belong-to-anyone.md)). The changes that person makes by hand and the changes the tool makes through the token then look the same on GitHub.
- GitHub limits the calls an account can make in an hour, shared by every token of that account and by its own use. On a large installation the hourly re-check may run into that limit sooner than through an App.
- Not every kind of token may reach the Projects status field. A guide read on 2026-11-03 (https://github.github.com/gh-aw/reference/auth-projects/) documents fine-grained tokens for projects owned by an organization only, and a classic token with the `project` scope for projects owned by a user. GitHub's own documentation was not checked; the install instructions must say which token each function needs.
- Whether GitHub sends changes to the Projects status field to repository or organization webhooks was not checked. Where it does not, start and hold ([DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)) arrive only through the hourly re-check.

## Serves

This decision serves [SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md), [SRC-228](SRC-228-some-companies-do-not-allow-github-apps.md), [SRC-230](SRC-230-repository-and-organization-webhooks-are-accepted-.md), [SRC-231](SRC-231-a-personal-access-token-may-belong-to-anyone.md), [SRC-232](SRC-232-the-system-admin-is-notified-of-an-expired-or-revo.md), [SRC-233](SRC-233-the-tool-is-not-deployed-without-an-app-or-a-token.md), [SRC-207](SRC-207-github-access-may-use-one-app-per-function.md), [SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md), [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md), [DD-003](DD-003-notifications-are-in-app-only.md), [DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md), [DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md).

Origin: proposed by Claude for issue #37, after the owner asked for personal access tokens beside Apps in the design session of 2026-11-03 (SRC-229, SRC-228). Choosing per function is Claude's. Refusing a function given both an App and a token, or neither, was Claude's proposal; the owner accepted it in the same session ("ok"), adding that an installation without an App or a token must not deploy (SRC-233). Mixing by function only, token scoping (SRC-229), repository and organization webhooks (SRC-230), tokens of any account (SRC-231) and notifying the system admin (SRC-232) come from the owner's answers in the same session. One secret for all repository and organization webhooks, accepting them also beside Apps, and naming the function in the notification are Claude's. The wording, alternatives, rationale, trade-offs and risks are Claude's. The owner confirmed these proposals and the decision in the design session of 2026-11-03: "proposals confirmed, mark DD-060 confirmed".
