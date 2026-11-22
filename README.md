# cold-seance

cold-seance is a self-hosted, open-source project planning tool for teams that work on GitHub. The plan lives in the tool: tasks, subtasks, dependencies, milestones, assignments and dates. GitHub issues mirror that plan, and on GitHub people only start, hold and finish the work.

- **Plan in one place.** Tasks have durations in working days, effort, an AI share, who _can_ do them and who _will_. Subtasks, blocked-by relations and milestones are scheduling constraints. Within a project, moving one task moves the tasks that depend on it.
- **See the whole picture.** The views are a Kanban, a Gantt with constraint violations in red and optional baseline bars, each person's load across all projects, and planned against baseline against actual dates.
- **Flag conflicts across projects, never fix them silently.** People and milestones can be shared between projects. An overload or a slipped milestone shows in red to every project involved, and no project's plan changes because of another's.
- **Keep GitHub in line.** Each task can have a linked issue. The tool keeps the issue's assignees, sub-issues, blocked-by relations and milestone the same as the task. It reads starts, holds and closes back from GitHub, and undoes changes on GitHub that would break the plan.
- **AI proposes, people approve.** An AI assistant connects through the MCP server or the REST API, reads the plan and proposes changes. A person reviews each proposal as a live preview in the browser, edits it if needed, and approves or rejects it.

## Installing

cold-seance is one application backed by a PostgreSQL database. Pick the way to run it that suits your machine:

| Option                                                                                                   | Best for                                                                                                | What you need                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [**Docker Compose**](docs/user-guide/install-docker.md)                                                  | Linux servers, and anyone already using containers. One command starts the tool and a bundled database. | Docker Engine, Podman or a similar container runtime |
| [**Windows portable zip**](docs/user-guide/install-windows.md#option-a-download-the-zip)                 | Windows machines without Docker, WSL or virtualization.                                                 | Windows x64, and a PostgreSQL you install            |
| [**Windows, built from source**](docs/user-guide/install-windows.md#option-b-build-the-package-yourself) | Windows users who would rather not run a downloaded, unsigned binary.                                   | Windows x64, Node.js 26, git and PostgreSQL          |

Every option then needs the same two things, which the [configuration guide](docs/user-guide/configuration.md) and the [GitHub setup guide](docs/user-guide/github-setup.md) cover:

1. A `config.yaml` with the database address, the first admin account and the GitHub access.
2. GitHub access: a GitHub App you register, or personal access tokens, and optionally webhooks.

Before you put the tool on a network, read [Running it on a network](docs/user-guide/configuration.md#running-it-on-a-network). Browsers sign in only over HTTPS, or on the machine itself.

## Documentation

The [user guide](docs/user-guide/README.md) covers installing, configuring and using the tool:

- **Install and run:** [Docker Compose](docs/user-guide/install-docker.md), [Windows](docs/user-guide/install-windows.md), [configuration](docs/user-guide/configuration.md), [GitHub setup](docs/user-guide/github-setup.md), [troubleshooting](docs/user-guide/troubleshooting.md)
- **Use it:** [getting started](docs/user-guide/getting-started.md), [planning tasks and milestones](docs/user-guide/planning.md), [the views](docs/user-guide/views.md), [people, roles and calendars](docs/user-guide/people-and-access.md), [repositories and the GitHub sync](docs/user-guide/github-sync.md), [notifications and the audit log](docs/user-guide/notifications-and-audit-log.md)
- **Connect AI and other tools:** [AI proposals and the MCP server](docs/user-guide/mcp-and-proposals.md), [REST API](docs/user-guide/rest-api.md)

## Getting help and contributing

- **Questions and bugs:** open an [issue](https://github.com/csillagu/cold-seance/issues).
- **Security vulnerabilities:** report them privately, as [`SECURITY.md`](SECURITY.md) describes.
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md) explains how the project is organised, how to set up a development environment and how to submit a change.

## License

cold-seance is licensed under the [Apache License 2.0](LICENSE).

---

The requirements of cold-seance are kept as a [reqlite](https://github.com/major-solutions/reqlite) graph in [`graph/`](graph/): every feature traces back to a recorded stakeholder need, and every design choice to its rationale.
