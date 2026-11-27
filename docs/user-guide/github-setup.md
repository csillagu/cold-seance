# GitHub setup

cold-seance talks to GitHub to create and update the issues of planned tasks, and to read back what people do on them. This page covers what an installation needs on the GitHub side. How the sync behaves once it runs is in [Repositories and the GitHub sync](github-sync.md).

- [Choose: a GitHub App or personal access tokens](#choose-a-github-app-or-personal-access-tokens)
- [Register a GitHub App](#register-a-github-app)
- [Use personal access tokens](#use-personal-access-tokens)
- [The Projects status field](#the-projects-status-field)
- [Webhooks](#webhooks)
- [What to look out for](#what-to-look-out-for)

## Choose: a GitHub App or personal access tokens

The tool needs access for three functions: reading issues (`readIssues`), writing to issues (`writeIssues`) and the Projects status field (`projectsStatus`). [Configuration](configuration.md#github-access) shows how to give each one. Each function gets either an App or a token, and you can mix them.

| | GitHub App | Personal access token |
| --- | --- | --- |
| **Acts on GitHub as** | the App, shown as `<app name>[bot]` | the GitHub account that owns the token |
| **Reaches** | the repositories it is installed on | what the token and its owner can reach |
| **Expires** | never; the tool renews its short-lived installation tokens itself | when the token expires or is revoked |
| **Webhooks** | the App's own webhook, set up once | set up on each repository or organization |
| **Good for** | most installations | organisations that do not allow GitHub Apps, a quick trial, or a Project owned by a user account |

A common setup is **one App for `readIssues` and `writeIssues`**, plus, if your GitHub Project belongs to a user rather than an organization, **a classic token for `projectsStatus`**.

## Register a GitHub App

Apps are registered by hand. The tool does not create them.

1. **Open the form.** For an App owned by an organization: the organization's **Settings → Developer settings → GitHub Apps → New GitHub App**. For one owned by your account: your **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Name and homepage.** Any name. The homepage URL can be the tool's address.
3. **Webhook.** If GitHub can reach the tool over HTTPS from the internet, tick **Active**, set the URL to `https://<the tool's address>/api/github/webhooks`, and choose a long random secret. Otherwise, untick **Active**. See [Webhooks](#webhooks) for what you lose without them.
4. **Repository permissions:**
   - **Issues:** Read and write
   - **Metadata:** Read-only (GitHub sets it)
5. **Organization permissions**, only if your status field is in a Project owned by an organization:
   - **Projects:** Read and write
6. **Subscribe to events**, if the webhook is active: **Issues**, **Sub issues**, **Issue dependencies**, and, with the Projects permission, **Projects v2 item**.
7. **Where can this App be installed:** *Only on this account* is enough when all the repositories are under the App's owner.
8. **Create** the App. On its page, note the **App ID**, then under **Private keys** choose **Generate a private key**. GitHub downloads a `.pem` file. Keep it safe: it is the App's password.
9. **Install the App** (**Install App** in the App's settings) on the account or organization, and choose the repositories the tool should plan in. The tool reaches only the repositories the App is installed on. To add one later, change the installation.

Then give the tool the App ID and the path of the `.pem` file:

```yaml
github:
  apps:
    readIssues: &app
      appId: 123456
      privateKeyFile: /run/secrets/github-app.pem
      webhookSecret: the-secret-from-step-3 # only with an active webhook
    writeIssues: *app
    projectsStatus: *app
```

You can register more than one App, such as a read-only one for `readIssues` and another for `writeIssues`. Each needs only the permissions of its functions.

**Too few permissions only show later.** The tool does not check an App's permissions at start. A missing permission fails the first time the tool needs it, and the tool then reports that it cannot reach the repository. See [Troubleshooting](troubleshooting.md#github-cannot-be-reached).

## Use personal access tokens

A token is created on GitHub by the account that will own it (**Settings → Developer settings → Personal access tokens**). It may belong to any account, such as a dedicated bot account. Everything the tool does through it shows on GitHub as that account's work.

| Function | Fine-grained token | Classic token |
| --- | --- | --- |
| `readIssues` | The repositories, with **Issues: Read-only** and **Metadata: Read-only** | `repo` (or `public_repo` for public repositories only) |
| `writeIssues` | The repositories, with **Issues: Read and write** and **Metadata: Read-only** | `repo` (or `public_repo`) |
| `projectsStatus` | For a Project owned by an **organization**: **Projects: Read and write** in the organization's permissions, and the repositories with **Issues: Read-only** | For a Project owned by a **user**, the only option: `project`, plus `repo` for private repositories |

A fine-grained token cannot reach a Project owned by a user account, so that case needs a classic token.

Give the token as its value, preferably in an environment variable:

```sh
COLD_SEANCE_GITHUB_TOKENS_READ_ISSUES=github_pat_...
COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES=github_pat_...
COLD_SEANCE_GITHUB_TOKENS_PROJECTS_STATUS=ghp_...
```

**When a token expires or is revoked,** GitHub refuses it, and the tool notifies every system admin in the app. That function then stops working until the tool is restarted with a new token. Note the expiry date when you create a token, and replace the token before then.

## The Projects status field

On GitHub, people start and hold a task by moving its issue in a GitHub Project, and finish it by closing the issue. The tool reads start and hold from a single-select field in whichever Project the issue is in:

- the field named `Status`, unless `github.statusField.name` says otherwise;
- its option `In Progress` starts the task, and `On Hold` puts it on hold (`github.statusField.started` and `github.statusField.onHold`);
- any other option means neither.

GitHub's default `Status` field has `Todo`, `In Progress` and `Done`. **Add an `On Hold` option** to it, or point the settings at the options you use. Names are compared ignoring case.

An issue that is in no Project can still be finished by closing it, but it cannot be started or held from GitHub.

## Webhooks

Webhooks are optional. With them, a change made on GitHub reaches the tool within seconds. Without them, the tool sees it at its next re-check, every 60 minutes unless `github.recheckIntervalMinutes` says otherwise.

New issues come in without webhooks too: each re-check lists the issues of the repositories projects pull from, and brings in those opened since the receiving project was given the repository. Without a webhook, a new issue becomes a task only at the next re-check.

The endpoint is `https://<the tool's address>/api/github/webhooks`. GitHub must be able to reach it from the internet. There are two kinds of sender:

- **An App's webhook.** Set it up in the App's settings, as in step 3 above, and give the tool its secret as `github.apps.<function>.webhookSecret`.
- **A repository's or an organization's webhook.** Use this when you use tokens rather than an App. In the repository's or organization's **Settings → Webhooks → Add webhook**:
  - **Payload URL:** the endpoint above
  - **Content type:** `application/json`
  - **Secret:** one secret, the same for every repository and organization, which you give the tool as `github.webhookSecret`
  - **Events:** *Let me select individual events*, then **Issues**, **Sub issues** and **Issue dependencies**, and, on an organization's webhook, **Projects v2 item**

The tool accepts a delivery only if its signature matches the sender's secret. It refuses any other delivery with `401` and ignores it. With no secret configured for a sender, all of that sender's deliveries are refused.

**GitHub sends no webhook for a change in a Project owned by a user account.** A start or hold made there reaches the tool at the next re-check, whatever else you set up. A shorter `github.recheckIntervalMinutes` brings such changes in sooner, at the cost of more calls to GitHub.

## What to look out for

- **Give each function exactly one App or one token.** Both, or neither, stops the start.
- **Install the App on every repository** you want to plan in. Then [register the repository in the tool](github-sync.md#register-a-repository).
- **Add `On Hold` to the Projects status field**, or starts will come through but holds will not.
- **A Project owned by a user needs a classic token** for `projectsStatus`, and its changes arrive only through the re-check.
- **No webhook means no new issues** become tasks by themselves, and status changes arrive only at the re-check.
- **Watch token expiry dates.** An expired token stops its function until you restart the tool with a new one.
