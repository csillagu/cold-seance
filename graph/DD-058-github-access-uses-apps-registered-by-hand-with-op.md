---
certainty: verified
---

# DD-058: GitHub access uses Apps registered by hand, with optional webhooks

## Decision

Whoever installs the tool registers its GitHub App on GitHub by hand ([SRC-208](SRC-208-github-apps-are-registered-by-hand-only.md)), with the permissions the tool needs, and installs it on each repository ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)). One App may serve all of the tool's functions on GitHub, or each function may have its own: reading issues, writing to issues, and the Projects status field ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)). Each App is given to the tool by its id and private key ([SRC-214](SRC-214-a-github-app-is-given-by-its-id-and-private-key.md)), in the tool's configuration ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)). The tool calls GitHub as the App given for each function, with that App's installation on each repository.

Webhooks are optional ([SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md)). The tool has a webhook endpoint of its own. To use it, the person registering an App sets that endpoint as the App's webhook address on GitHub, with a webhook secret of their choosing, and gives the tool the same secret in its configuration. The tool checks each delivery against the secret of the App that sent it. An App with no webhook secret configured sends no webhooks the tool accepts. Changes then reach the tool through the hourly re-check alone ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md), [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)), which also catches whatever the webhooks missed.

The webhook secret is entered on both sides because GitHub signs each delivery with it: the tool knows a delivery is genuine only if it holds the same secret. The address is the tool's, but the secret is chosen when the App is registered, and the tool cannot learn it from GitHub.

## Alternatives considered

- Creating the App from a setup page in the tool through GitHub's App manifest flow (the retired DD-053), which the owner rejected: "The only way should be user updating it manually."
- Typing the App's id and private key into a setup page in the tool, which the owner rejected in favour of configuration ([SRC-210](SRC-210-secrets-are-given-in-configuration-not-typed-in.md)).
- Webhooks required, or no webhooks at all.
- One App shared by every installation and run by the project, with a relay that forwards its webhooks to each installation.

## Rationale

The owner set registration by hand as the only way ([SRC-208](SRC-208-github-apps-are-registered-by-hand-only.md)), one App per function as allowed ([SRC-207](SRC-207-github-access-may-use-one-app-per-function.md)), and webhooks as optional ([SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md)). Webhooks bring changes from GitHub within moments instead of within the hour, and an installation that GitHub cannot reach still works through the hourly re-check, the worst-case delay the owner accepted ([SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md)). A shared App would need a service the project hosts for every installation, against a self-hosted tool ([SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md)).

## Trade-offs

- Installing is more steps than one: the App is registered on GitHub by hand, with the right permissions and, for webhooks, the tool's address and a secret. The install instructions must list them ([SRC-199](SRC-199-people-can-install-the-tool-simply.md)).
- An App registered with too few permissions fails only when the tool first needs the missing one.
- With one App per function, there are as many private keys, and webhook secrets, to keep.

## Risks

- Anyone who can read the configuration, or the host it is on, gets the Apps' private keys and can act as the Apps on every repository they are installed on.
- GitHub sends webhooks for changes to the Projects status field only for projects owned by an organization, and only to an App with the organization's "Projects" permission. For a project owned by a user account, start and hold ([DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)) arrive only through the hourly re-check. GitHub's documentation lists the Projects webhooks as a public preview that may change.
- A webhook delivery that is not checked against the secret would let anyone change the tool's tasks by posting a fake event.

## Serves

This decision serves [SRC-207](SRC-207-github-access-may-use-one-app-per-function.md), [SRC-214](SRC-214-a-github-app-is-given-by-its-id-and-private-key.md), [SRC-208](SRC-208-github-apps-are-registered-by-hand-only.md), [SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md), [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md), [SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md), [DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md), [DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md).

Origin: replaces DD-053, which the owner chose and confirmed in the design session of 2026-11-02 ("Gh app A", "Certainty verified") and overtook in the design session of 2026-11-03 with SRC-207, SRC-208, SRC-209 and SRC-214. The limit on Projects webhooks comes from GitHub's documentation of webhook events (https://docs.github.com/en/webhooks/webhook-events-and-payloads), read on 2026-11-02, and is carried over from DD-053. Accepting webhooks only from an App whose secret is configured was Claude's proposal. The wording, alternatives, rationale, trade-offs and risks are Claude's. The owner confirmed the decision in the design session of 2026-11-03: "DD-058 confirmed".
