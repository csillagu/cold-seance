# Troubleshooting

## Where the log is

| Installation | Log |
| --- | --- |
| Docker Compose | `docker compose logs app` (add `-f` to follow it) |
| Windows, `start.cmd` | The command prompt it runs in |
| Windows service | `cold-seance-service.out.log` and `cold-seance-service.err.log` in the tool's folder |

## The tool does not start

The tool checks its whole configuration first. It prints every problem it finds and exits. Read the list, fix each item, and start again.

| The log says | Do this |
| --- | --- |
| A setting is required, or a value is not valid | Set it, in `config.yaml` or as an environment variable. See [all settings](configuration.md#all-settings). |
| A key, or a `COLD_SEANCE_` variable, is not a known setting | Fix the spelling. A misspelt setting is refused rather than ignored. |
| A GitHub function is given both an App and a token, or neither | Give each of `readIssues`, `writeIssues` and `projectsStatus` exactly one. An environment variable counts as well as the file. |
| A key file cannot be read | Check the path and the file's permissions. With Docker, the path is inside the container (`/run/secrets/...`) and the file must be readable by uid 1000. On Windows, check the `icacls` grants and use single quotes around the path. |
| The first admin settings cannot be used | Give both username and password, or neither, and do not name an existing account that is not a system admin. |
| A migration failed, or the database cannot be reached | Check `database.url`, that PostgreSQL runs and accepts the connection, and that the user owns the database. Behind a connection pooler, set `database.directUrl`. |

If the port is already taken, set `server.port` to another one.

## Sign-in does not work

- **You come back to the sign-in page after signing in.** The browser reached the tool over plain HTTP from another machine, and dropped the sign-in cookie, which needs HTTPS. Use `http://localhost:3000` on the machine itself, or put the tool [behind HTTPS](configuration.md#running-it-on-a-network).
- **The first admin's credentials are refused.** The first admin is only created while no system admin exists. If one existed already, such as from an earlier start with other settings, sign in with that account.
- **A forgotten password.** The tool has no way yet to change a password. A system admin can create a new account for the person.

## GitHub cannot be reached

**Registering a repository is refused because the tool cannot reach it,** or the log reports that GitHub cannot be reached for a repository. Depending on what gives `readIssues`, check that:

- the App is installed on that repository (in the App's installation settings, under repository access), and the installation is not suspended;
- the App has the permissions listed in [GitHub setup](github-setup.md#register-a-github-app);
- the token can see the repository: a fine-grained token's repository list, or a classic token's owner's access, and its scopes.

A classic token without the scope a call needs may be answered by GitHub with "not found" rather than "forbidden". Check the scopes before suspecting the repository name.

**A token stopped working.** GitHub refused it as expired or revoked, and every system admin got a notification naming the function. Create a new token, set it in the configuration and restart the tool: the function stays off until then.

## Changes on GitHub do not show up in the tool

- **Without webhooks,** changes arrive at the next re-check, every `github.recheckIntervalMinutes` (60 by default).
- **With webhooks,** look at the webhook's **Recent Deliveries** on GitHub. A `401` answer means the secret does not match: the App's secret goes in `github.apps.<function>.webhookSecret`, a repository's or organization's in `github.webhookSecret`. A delivery that never arrives means GitHub cannot reach the tool's address.
- **Start and hold from a Project owned by a user account** always wait for the re-check: GitHub sends no webhook for those.
- **A status-field move does nothing:** check that the field and its options match `github.statusField` (by default `Status`, `In Progress` and `On Hold`), and that the issue is in the Project.
- **The project's approval for the repository was withdrawn:** its tasks from that repository no longer sync.

## New GitHub issues do not become tasks

A new issue becomes a task only when:

1. a [webhook](github-setup.md#webhooks) tells the tool of it: the re-check does not pick up new issues; and
2. a project can take it: the repository's receiving project, or the one project that pulls from the repository. See [The receiving project](github-sync.md#the-receiving-project).

To bring in issues that already exist, [seed](github-sync.md#seed-a-project-from-github) the project.

## The tool undid my change on GitHub

That is by design. The plan lives in the tool:

- assignees, sub-issues and blocked-by relations are set back to the plan;
- a start, close or delete that breaks a constraint, such as an unfinished blocker or an open sub-issue, is reverted, and the comment the tool leaves on the issue says why.

Change the plan in the tool instead. See [Changes the tool undoes on GitHub](github-sync.md#changes-the-tool-undoes-on-github).

## Planning

| Symptom | Why |
| --- | --- |
| A task cannot be started or finished | A task it is blocked by is not done, or, to finish, one of its subtasks is open. |
| A date is refused | It falls on one of the task's non-working days: a weekend day, a company holiday, or a day off of someone assigned to it. |
| A task cannot be given a duration of 0 | Only a new task can become a milestone. |
| Someone is not offered for a task | They need a role in the project, read-only at least. |
| A project says it is not visible to you | You have no role in it, directly or through a group. Ask one of its admins. |
| A task did not move when someone took a day off | Scheduling never moves a task because its people became unavailable. It turns red instead. |
| Another project's milestone moved, but your task did not | No project's plan changes because of another project. The dependency turns red instead. |

## Proposals

| Symptom | Why |
| --- | --- |
| Approving asks you to confirm again | The plan changed since the preview you saw. Check the refreshed preview, and confirm. |
| Approval is refused | You need the read-write or admin role in that project's part, and the proposal must still be waiting: not approved, rejected or expired. |
| A proposal is marked expired | Nobody edited it for 24 hours. Ask the AI for a new one. |
| A proposal is not visible to you | It changes a project you have no role in. |
| The AI's `create_proposal` is refused | The account needs the read-write or admin role in every project it changes, and a proposal may change only tasks. The error says which rule. |
