# DD-060: A GitHub function is given an App or a personal access token

## Decision

For each of the tool's functions on GitHub, reading issues, writing to issues and the Projects status field ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)), the configuration ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)) gives either a GitHub App, as [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md) describes, or a personal access token ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). One token may be given for every function, or a separate one for each, and functions given a token may sit beside functions given an App. For a function given a token, the tool calls GitHub with that token, as the GitHub account that owns it, on the repositories the token can reach. A function given both an App and a token, or neither, stops the tool at start, naming the function.

The token is created on GitHub by the account that owns it; the tool does not create it. The tool uses the token as given and does not tell the kinds of GitHub token apart.

Webhooks stay those of [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md): only an App sends webhooks the tool accepts. An installation that gives every function a token therefore receives changes from GitHub through the hourly re-check alone, which the owner allowed ([SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md)). Whether the tool should also accept webhooks set up on a repository or an organization, for an installation that uses no App, is not stated.

## Alternatives considered

- Apps only, as before: ruled out by the owner's request, since some companies do not allow Apps ([SRC-228](SRC-228-some-companies-do-not-allow-github-apps.md)).
- Tokens only: ruled out by the owner, "Both should be an option".
- One kind for the whole installation, all Apps or all tokens: ruled out by the owner, "the two can be mixed".
- For a function given both an App and a token: preferring one of them, rather than refusing to start.

## Rationale

The owner asked for tokens beside Apps, as granular as Apps and mixable with them ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). Choosing per function keeps the shape that Apps already have ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)): each function names what the tool calls GitHub as for it. Refusing to start on a function given both, or neither, follows the configuration's rule of refusing a missing setting ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)), and avoids a silent choice between the two.

## Trade-offs

- What the tool does through a token appears on GitHub as the token's account, not as an App: the issues it creates, the comments that explain a revert ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)) and the status changes it makes carry that account's name.
- A token reaches what its account can reach, within the limits set when the token is created, rather than the repositories each repository's admin installed an App on ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)). Which repositories the tool can register then depends on whoever created the token.
- A token may expire or be revoked. The tool cannot renew it: the function stops until a new token is configured and the tool restarted. How the tool reports that is not stated.

## Risks

- Anyone who can read the configuration, or the host it is on, gets the tokens and can act as their accounts on everything the tokens reach.
- If a token's account belongs to a person who also works on GitHub, the changes that person makes by hand and the changes the tool makes look the same on GitHub. Whether a token must belong to an account used by the tool alone is not stated.
- GitHub limits the calls an account can make in an hour, shared by every token of that account and by its own use. On a large installation the hourly re-check may run into that limit sooner than through an App.
- Not every kind of token may reach the Projects status field. A guide read on 2026-11-03 (https://github.github.com/gh-aw/reference/auth-projects/) documents fine-grained tokens for projects owned by an organization only, and a classic token with the `project` scope for projects owned by a user. GitHub's own documentation was not checked; the install instructions must say which token each function needs.

## Serves

This decision serves [SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md), [SRC-228](SRC-228-some-companies-do-not-allow-github-apps.md), [SRC-207](SRC-207-github-access-may-use-one-app-per-function.md), [SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md), [DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md), [DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md).

Origin: proposed by Claude for issue #37, after the owner asked for personal access tokens beside Apps in the design session of 2026-11-03 (SRC-229, SRC-228). Choosing per function, refusing a function given both or neither, and keeping webhooks to Apps are Claude's. The wording, alternatives, rationale, trade-offs and risks are Claude's. It awaits the owner's confirmation.
