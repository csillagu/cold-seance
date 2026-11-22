# Contributing to cold-seance

Thank you for considering a contribution. Bug reports, questions, fixes and features are all welcome. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How the project is organised

What the tool must do is recorded as requirements in [`graph/`](graph/), a [reqlite](https://github.com/major-solutions/reqlite) graph: one markdown file per item, from the stakeholder's sources (SRC) and design decisions (DD) through use cases (UC) and functional requirements (FR) to the solution components (SC) that get built and the test cases (TC) that check them. [`ruleset/`](ruleset/) holds the graph's type system. Code comments and the developer documentation name these items by id, such as SC-073 or DD-040.

Two documents order the work:

- [`docs/implementation-plan.md`](docs/implementation-plan.md), the **implementation plan**: every solution component in build order, in waves, with the status of each. It is the record of what is done.
- [`plan/work-graph.md`](plan/work-graph.md), the **parallel work graph**: the components not yet built, cut into issue-sized nodes with "blocked by" relations, so that several people or agents can work at once. Its data is in [`plan/work-graph.yaml`](plan/work-graph.yaml). [`plan/create-issues.py`](plan/create-issues.py) turns it into GitHub issues, and agents take them one at a time as [`plan/agent-prompt.md`](plan/agent-prompt.md) sets out.

[`docs/initial-requirements.md`](docs/initial-requirements.md) is the stakeholder's original input, kept frozen, and [`design/`](design/) holds the approved look of the frontend.

## Documentation

| For                                                                   | Read                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| Installing and using the tool                                         | The [user guide](docs/user-guide/README.md)              |
| The workspace, running it locally, checks, tests, the database schema | The [development reference](docs/development/README.md)  |
| How the REST API, the MCP server and the GitHub side work inside      | [Architecture](docs/development/architecture.md)         |
| The Docker image, the Windows package, CI, releases and code signing  | [Packaging and CI](docs/development/packaging-and-ci.md) |
| The test deployment and the live GitHub tests                         | [Live tests](docs/development/live-tests.md)             |

A change in what users see or do also updates the user guide, in the same pull request.

## Before you start

- **Bugs:** open an issue with the bug report form. For a security vulnerability, follow [`SECURITY.md`](SECURITY.md) instead.
- **Features and larger changes:** open an issue first, so we can agree what the tool should do before code is written. A change in behaviour starts in the requirements graph.
- **Small fixes** (typos, an obvious bug with a test): a pull request alone is fine.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set up the development environment as the [development reference](docs/development/README.md) describes: Node.js 26 (see `.nvmrc`), `npm ci`, and PostgreSQL (Docker is easiest) for the integration and browser tests.
3. Make the change, with tests. Unit tests sit next to the code as `*.test.ts(x)`. Integration tests are in `backend/test/integration/`, and browser tests in `e2e/tests/`.
4. A change to the database schema needs its migration: run `npm run db:generate -w backend` and commit what it writes (see [Database schema](docs/development/README.md#database-schema)).
5. Add a dependency with `npm install -w <package>`, so `package-lock.json` stays the one lockfile.
6. Run the checks:

   ```sh
   npm run check                 # format, lint, typecheck, db:check, unit tests, build
   npm run test:integration      # if the backend changed; needs TEST_DATABASE_URL
   ```

   `npm run format` fixes formatting.

7. Open a pull request against `main` and fill in the template: link the issue, say what changed and why, and list any decisions you made that the issue did not settle.

CI runs every check, the browser tests and the Docker image tests on each pull request. A maintainer reviews it and merges it with a merge commit.

## Commits

Keep each commit focused, with a message that says what changed and why, and reference the issue, such as `Add login form (#12)`.

## AI coding agents

Much of this repository is written by AI coding agents (Claude Code) working on the issues of the work graph. [`CLAUDE.md`](CLAUDE.md) holds the rules they follow, and they apply to agent-written contributions from outside too. You are responsible for every change you submit, however it was written.

## License

cold-seance is licensed under the [Apache License 2.0](LICENSE). As section 5 of that license says, a contribution you submit for inclusion is licensed under the same terms, unless you state otherwise.
