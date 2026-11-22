# cold-seance user guide

This guide is for the people who install cold-seance and the people who plan with it. For working on the code, see [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Install and run

| Guide | What it covers |
| --- | --- |
| [Installing with Docker Compose](install-docker.md) | The published image and a bundled PostgreSQL; backups, restores and updates |
| [Installing on Windows](install-windows.md) | The portable zip or a build from source, PostgreSQL, the optional Windows service, the unsigned-download warnings, backups, restores and updates |
| [Configuration](configuration.md) | Every setting, as a YAML file or environment variables; running the tool on a network |
| [GitHub setup](github-setup.md) | A GitHub App or personal access tokens, their permissions, webhooks and the Projects status field |
| [Troubleshooting](troubleshooting.md) | What to check when the tool does not start, sign-in fails or GitHub does not sync |

## Use it

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | From the first sign-in to a first planned project |
| [Planning tasks and milestones](planning.md) | Tasks, durations, effort and AI share, milestones, subtasks and dependencies, scheduling, who can and who will do a task, status and cancelling |
| [The views](views.md) | Kanban, Gantt, person load, baseline variance, saved views, the Mermaid export |
| [People, roles and calendars](people-and-access.md) | Accounts, project roles, groups, capacity, absences, the company and personal calendars |
| [Repositories and the GitHub sync](github-sync.md) | Registering repositories, adding them to projects, seeding a project from GitHub, what syncs in each direction |
| [Notifications and the audit log](notifications-and-audit-log.md) | In-app notifications, subscriptions, who changed what |

## Connect AI and other tools

| Guide | What it covers |
| --- | --- |
| [AI proposals and the MCP server](mcp-and-proposals.md) | Connecting an AI assistant, the MCP tools, the proposal format, reviewing and approving proposals |
| [REST API](rest-api.md) | Tokens, the OpenAPI description, conventions and examples |

## Words used in this guide

- **Project:** a plan of its own, with its own members and roles. A person can work in many projects.
- **Task:** a unit of work in a project. A **milestone** is a task that takes no time.
- **Unscheduled task:** a task without planned dates, such as one created from a new GitHub issue.
- **Red flag:** a conflict the tool shows in red: a person overloaded or away during their task, a fixed-date milestone pushed by what it waits for, or another project's milestone moving past the task that depends on it.
- **System admin:** an account that administers the installation: accounts, the company calendar and the full audit log. It is not a role in any project.
- **Proposal:** a set of changes to the plan, made by an AI or another program, that people review before anything changes.
