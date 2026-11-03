---
certainty: verified
---

# DD-053: Each installation sets up its own GitHub Apps on a setup page in the tool

## Decision

Each installation of the tool has its own GitHub App ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)), or one App for each of the tool's functions on GitHub: reading issues, writing to issues, and the Projects status field. The same App can be given for all of them ([SRC-205](SRC-205-github-access-may-use-one-app-per-function-entered.md)). The Apps are set up by an admin on a setup page in the tool ([SRC-206](SRC-206-an-admin-uses-the-github-app-setup-page.md)), in either of two ways:

- Created from the page through GitHub's App manifest flow: one step on GitHub creates the App with the permissions the tool needs and with the tool's webhook address. GitHub then returns the App's id, private key and webhook secret, and the tool stores them in its database.
- Entered by hand: the admin registers the App on GitHub and types its id and private key into the page for each function ([SRC-205](SRC-205-github-access-may-use-one-app-per-function-entered.md)). The tool stores them in its database.

Not stated: whether the manifest flow can also create one App per function, and whether an App entered by hand sends webhooks, and so needs its webhook secret entered too.

Changes on GitHub reach the tool through the App's webhooks, and the tool checks each delivery against the webhook secret. The hourly re-check ([DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md)) catches whatever the webhooks missed ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)). The tool calls GitHub as the App, with the App's installation on each repository.

## Alternatives considered

- Registering the App by hand in GitHub's settings and passing its id, private key and webhook secret to the tool as environment variables, instead of entering them on the setup page.
- Either of these without webhooks, relying on the hourly re-check alone, which the owner accepted as the worst-case delay ([SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md)).
- One App shared by every installation and run by the project, with a relay that forwards its webhooks to each installation.

## Rationale

The manifest flow keeps connecting GitHub to one step, in line with simple installation ([SRC-199](SRC-199-people-can-install-the-tool-simply.md)). Webhooks bring changes from GitHub within moments instead of within the hour. A shared App would need a service the project hosts for every installation, against a self-hosted tool ([SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md)). A personal token of a bot account is not an option, because the tool works through a GitHub App installed per repository ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)).

## Trade-offs

- The App's private key and webhook secret are kept in the tool's database instead of the host's configuration.
- GitHub must be able to reach the tool over the network, both for the manifest flow's return and for webhook deliveries.
- An App entered by hand has the permissions whoever registered it gave it; the tool cannot set them.

## Risks

- Anyone who gets a copy of the database, a backup for example, also gets the App's private key and can act as the App on every repository it is installed on.
- A tool that GitHub cannot reach, such as one on a private network, gets no webhooks. It then learns of changes only through the hourly re-check.
- GitHub sends webhooks for changes to the Projects status field only for projects owned by an organization, and only to an App with the organization's "Projects" permission. For a project owned by a user account, start and hold ([DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)) arrive only through the hourly re-check. GitHub's documentation lists the Projects webhooks as a public preview that may change.
- A webhook delivery that is not checked against the secret would let anyone change the tool's tasks by posting a fake event.

## Serves

This decision serves [SRC-205](SRC-205-github-access-may-use-one-app-per-function-entered.md), [SRC-206](SRC-206-an-admin-uses-the-github-app-setup-page.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md), [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md), [DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md), [DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md).

Origin: Claude set out four options in the design session of 2026-11-02, after the owner asked: "Yes what are the options". The owner chose this one: "Gh app A". The wording, alternatives, rationale, trade-offs and risks are Claude's. The limit on Projects webhooks comes from GitHub's documentation of webhook events (https://docs.github.com/en/webhooks/webhook-events-and-payloads), read on 2026-11-02. Confirmed by the owner in the same session: "Certainty verified". In the design session of 2026-11-03 Claude added, from the owner's answers, entering an App by hand, one App per function, and the admin who uses the setup page (SRC-205, SRC-206); the owner has not re-read the decision with them.
