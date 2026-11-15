# cold-seance

The requirements live in [`graph/`](graph/) (a [reqlite](https://github.com/major-solutions/reqlite) graph). Two documents order the work:

- [`docs/implementation-plan.md`](docs/implementation-plan.md), the **implementation plan**: every solution component in build order, in waves, with the status of each. It is the record of what is done.
- [`plan/work-graph.md`](plan/work-graph.md), the **parallel work graph**: the components not yet built, cut into issue-sized nodes with "blocked by" relations, so that several people or agents can work at once. Its data is in [`plan/work-graph.yaml`](plan/work-graph.yaml). [`plan/create-issues.py`](plan/create-issues.py) turns it into GitHub issues, and agents take them one at a time as [`plan/agent-prompt.md`](plan/agent-prompt.md) sets out.

## Development

The repository is one npm workspace with three packages, sharing one `package-lock.json`:

| Package                  | Stack                                                       |
| ------------------------ | ----------------------------------------------------------- |
| [`backend/`](backend/)   | Fastify on Node.js (DD-044), Drizzle on PostgreSQL (DD-057) |
| [`frontend/`](frontend/) | React, built with Vite (DD-045)                             |
| [`e2e/`](e2e/)           | The browser tests, with Playwright                          |

You need Node.js 26 (see [`.nvmrc`](.nvmrc); `nvm use` picks it up) and, for the integration tests, Docker or another PostgreSQL server.

```sh
npm ci                      # install exactly what package-lock.json records
npm run dev -w backend      # backend on http://localhost:3000, restarts on change
npm run dev -w frontend     # frontend dev server
```

The backend listens on `server.host` and `server.port` (127.0.0.1:3000 unless set). It also serves the built frontend, `frontend/dist/`, if there is one: its files as they are, and its `index.html` for any other GET outside `/api`, since the frontend is a single-page application. Without a build it serves only the API and says so in its log.

### Configuration

The backend reads its settings at start from a YAML file (DD-059): `config.yaml` in the directory it starts in, or the file named by `COLD_SEANCE_CONFIG_FILE`. [`backend/config.example.yaml`](backend/config.example.yaml) lists every setting. Each one can also be given by an environment variable, named after its path (`database.url` is `COLD_SEANCE_DATABASE_URL`, `github.apps.readIssues.appId` is `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID`), and **the environment variable wins over the file**; an empty variable counts as not set. A key in the file or a `COLD_SEANCE_` variable that is not a known setting stops the start, so a misspelt setting cannot go unnoticed. Without a file, the environment alone configures the tool.

Each GitHub function (reading issues, writing to issues, the Projects status field) is given either a GitHub App, under `github.apps.<function>`, or a personal access token, under `github.tokens.<function>` (DD-060); Apps and tokens can be mixed across functions, and one can serve several. A token is given as its value, so an environment variable such as `COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES` can keep it out of the file; the function must then not also be given an App under `github.apps`, in the file or the environment, or the two count as both. `github.webhookSecret` is the one secret of the webhooks set up on repositories and organizations, if any are used.

Start and hold are read from a GitHub Projects status field (DD-015), in whichever Project an issue is in: `github.statusField.name` names the field (`Status` unless set), `github.statusField.started` and `github.statusField.onHold` its options for started and on hold (`In Progress` and `On Hold` unless set), so a deployment of the Docker image sets them with `COLD_SEANCE_GITHUB_STATUS_FIELD_NAME`, `COLD_SEANCE_GITHUB_STATUS_FIELD_STARTED` and `COLD_SEANCE_GITHUB_STATUS_FIELD_ON_HOLD` (SRC-252). Option names are compared ignoring case.

The first system admin is given by `COLD_SEANCE_FIRST_ADMIN_USERNAME` and `COLD_SEANCE_FIRST_ADMIN_PASSWORD` (FR-165), together or not at all. At start, while no system admin exists, the backend creates that account as a system admin; sign in with it and create everyone else's account. Once a system admin exists, the two change nothing. The backend does not start if they name a username or password no account could have, or a username an account that is not a system admin already has.

A task's actual start and finish are recorded as the date of the day it is started or finished, in the backend's local time zone. Set it with the standard `TZ` environment variable, such as `TZ=Europe/Budapest`; without it the Docker image uses UTC.

The backend does not start if a required setting is missing, a value is not valid, a GitHub App's key file cannot be read, or a GitHub function is given both an App and a token, or neither; it prints each such setting or function and exits. To run `npm run dev -w backend`, copy the example to `backend/config.yaml` and fill it in. `config.yaml` is ignored by git, because it holds secrets.

### Checks

| Command                           | What it runs                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Everything below except the integration tests: run it before you push                                                |
| `npm run format` / `format:check` | Prettier                                                                                                             |
| `npm run lint`                    | oxlint, with type-aware rules                                                                                        |
| `npm run typecheck`               | `tsc` in both packages                                                                                               |
| `npm run db:check`                | Fails if the database schema has a change that no migration holds (SC-073)                                           |
| `npm run test:unit`               | Vitest unit tests, both packages                                                                                     |
| `npm run test:coverage`           | The unit tests with coverage: a summary in the terminal, an HTML report in each package's `coverage/`                |
| `npm run test:integration`        | Backend integration tests against PostgreSQL                                                                         |
| `npm run test:e2e`                | Browser tests: builds the frontend, then runs Playwright against the backend serving it, on PostgreSQL               |
| `npm run test:image`              | Tests of the Docker image (SC-028) and the Compose file (SC-029), against PostgreSQL; needs Docker and a built image |
| `npm run build`                   | Backend to `backend/dist/`, frontend to `frontend/dist/`                                                             |

### Parallel branches

Many branches are open at once. Before a branch is merged, `npm run db:rebase` brings it up to date: it fetches `origin/main`, rebases onto it, and generates the branch's migration again after `main`'s, in one commit. Two branches' migrations would otherwise share a number and a journal, and merging them by hand risks a migration that existing databases skip. New tables go in a schema module of their own under `backend/src/db/schema/`, re-exported from `backend/src/db/schema.ts`; `CLAUDE.md` lists the other habits that keep branches from colliding.

### Tests

- **Unit tests** sit next to the code they test, as `*.test.ts(x)` under `src/` (and `backend/scripts/`). They need no database. Backend tests drive the HTTP layer with Fastify's `inject()`; frontend tests use Testing Library in jsdom.
- **Integration tests** are in `backend/test/integration/`. They run against a real PostgreSQL. `createTestDatabase()` in `backend/test/helpers/database.ts` gives each test file a fresh, empty database with every migration applied, matching the test cases' "fresh test deployment". Start a server and point the tests at it:

  ```sh
  docker compose -f compose.test.yaml up -d
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:integration
  ```

- **Browser tests** are in `e2e/tests/`, as Playwright tests (`*.spec.ts`). They check the browser steps of the test cases, each test named with its TC's id. The `deployment` fixture of `e2e/fixtures.ts` gives each test a fresh test deployment of its own: a fresh database, the first system admin `root` (password `root-password`) and the backend serving the built frontend on a free port, which the test's `page` and `request` open by relative paths. `deployment.seedAccount('alice')` adds an account, password `alice-password`, and `deployment.db` puts in place anything else a test case's inputs give. They need PostgreSQL as the integration tests do, and Playwright's Chromium (`npx --workspace e2e playwright install chromium`, once):

  ```sh
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:e2e
  ```

### Docker image

The [`Dockerfile`](Dockerfile) builds the one application image (SC-028, DD-040): the built frontend and the backend, which serves it, in one process. It holds no configuration and no key file; give them at run time. The image listens on port 3000 on every interface of the container (it sets `COLD_SEANCE_SERVER_HOST=0.0.0.0`), runs as the unprivileged `node` user, applies the pending migrations to its database at start (SC-074), and closes cleanly when Docker stops it.

```sh
docker build -t cold-seance .
docker run -p 3000:3000 \
  -v ./config.yaml:/app/config.yaml:ro -v ./github-app.pem:/run/secrets/github-app.pem:ro \
  cold-seance
```

The database is the one in the configuration (FR-177): any PostgreSQL the container can reach, a hosted one included. A configuration file is read from `/app/config.yaml`, or from the path in `COLD_SEANCE_CONFIG_FILE`; each setting can also be given with `-e`. The mounted files must be readable by the `node` user (uid 1000) and should be readable by no one else on the host.

The image tests start containers of a built image against a PostgreSQL server, which the containers reach as `host.docker.internal`:

```sh
docker build -t cold-seance:test .
TEST_IMAGE=cold-seance:test TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:image
```

### Installing with Docker Compose

[`compose.yaml`](compose.yaml) is the tool's installation (SC-029, DD-040): the application image, `ghcr.io/csillagu/cold-seance:latest`, next to the official PostgreSQL 18 image, which keeps its data in the Compose volume `database`. In a directory holding `compose.yaml`:

```sh
cp backend/config.example.yaml config.yaml    # fill in the GitHub Apps or tokens and the database address
mkdir secrets && cp <key files> secrets/      # mounted at /run/secrets
docker compose up -d
```

- The database address is `database.url` in `config.yaml` (FR-177, DD-059). The bundled database is `postgres://cold_seance:cold_seance@database:5432/cold_seance`. Its password is a default: the database is not published, so only the application reaches it, over the Compose network.
- To use an existing or hosted PostgreSQL instead, put its address in `database.url` (and `database.directUrl` behind a pooler) and start the application alone: `docker compose up -d --no-deps app`.
- The tool is published on port 3000 of every interface of the machine.
- `config.yaml` and `secrets/` are mounted read-only and must exist; the start fails rather than mount empty directories in their place. They hold secrets: make them readable by the `node` user (uid 1000) and no one else.
- `docker compose pull && docker compose up -d` updates the tool to the latest image.
- **The volume is the data.** `docker compose down --volumes`, or removing the volume, deletes everything. Back it up with `docker compose exec -T database pg_dump -U cold_seance cold_seance > backup.sql`, and restore it into an empty volume with `docker compose exec -T database psql -U cold_seance -d cold_seance < backup.sql`. The PostgreSQL major version is fixed in `compose.yaml`; moving to a new one needs a dump and a restore, which Compose does not do.

The image tests (`npm run test:image`, above) also run the Compose file from a scratch install directory, with the image under test in place of the published one: with its bundled database, and with an external one while the bundled one is stopped.

### REST API

The REST API (SC-026) is served under `/api`, in `backend/src/api/`. Each part of the service layer gets a route group, added to `routeGroups` in `backend/src/api/api.ts`, and each module of the service layer is added to `Services` in `backend/src/service/services.ts`, which every route group is registered with as `services`. A route only translates the request and calls the service layer, passing it `callerOf(request)`; the rules, permission checks included, live in the service layer (DD-039), which refuses a request by throwing a `ServiceError` (`backend/src/service/errors.ts`). The API:

- refuses with 401, before the route runs, a request that no configured authenticator recognises (there is none yet, so every request is refused until the sign-in and token SCs add theirs); an unknown route under `/api` answers 401 too, and 404 only to an authenticated caller;
- refuses to start if a route lacks a success response schema that says what it sends (a `type`, and for an object its `properties` or a schema for its values), a body schema (POST, PUT, PATCH) or a params schema (a URL with parameters), so nothing goes out undescribed; a querystring schema is the route author's duty, as the guard cannot tell whether a route reads one;
- answers every error as `{ statusCode, error, message }`: a `ServiceError` as 400, 403, 404 or 409 with its message, a request Fastify itself refuses (schema, JSON, content type) with Fastify's status and message, and any other error, even one carrying a status of its own, as 500 with no detail, logged on the server.
- serves its OpenAPI description (SC-063) at `/api/openapi.json`, behind the same authentication. `@fastify/swagger` generates it from the routes' schemas as they are registered, so it always matches the running backend. So that it covers every route, the API refuses to start if a route would drop out of it or be described wrongly: a route with `hide: true` or the `X-HIDDEN` tag (only the description's own route is hidden), a route with a version constraint, a HEAD route declared by hand (the HEAD route Fastify adds for each GET is fine), or a shared schema `$id` added in two route groups with different content.

### GitHub client

The backend calls GitHub only through the GitHub client (SC-106, `backend/src/github/client.ts`). Each call names its function (`readIssues`, `writeIssues`, `projectsStatus`) and its repository, and carries what the configuration gives that function (DD-060): for an App, the token of its installation on that repository, from the GitHub App tokens (SC-108, `backend/src/github/app-tokens.ts`); for a personal access token, the token. `rest()` calls the REST API below the repository's path, `restPages()` reads a list over all its pages, and `graphql()` calls the GraphQL API, which the Projects status field needs. Besides GitHub's other answers (`GitHubRequestError`, with GitHub's status), a call rejects with:

- `GitHubUnreachableError` when the function's App or token cannot reach the repository: the App is not installed on it (an installation token GitHub stops accepting is dropped and the call sent once more, so an App uninstalled since is reported too) or its installation is suspended, GitHub does not show it to the token (a 404 within a repository is checked against the repository itself, so a missing issue is not mistaken for it), or GitHub refuses the function's access there (a 403, or a GraphQL `FORBIDDEN`, that is not a rate limit);
- `GitHubTokenRefusedError` when GitHub refuses a function's personal access token as expired or revoked (a 401). The function then stops working until the tool is restarted with a new token (DD-060): its later calls are refused without asking GitHub. Each refusal, the later ones included, is also handed to the client's `onTokenRefused`, for the system admins' notification (FR-186, SC-012).

A classic token without the scope a call needs may be answered with a 404 rather than a 403 on a repository it can read; the client then reports a `GitHubRequestError` with status 404, not that the token cannot reach the repository.

### GitHub planning mirror

The GitHub planning mirror (SC-022, `backend/src/github/planning-mirror.ts`) keeps the planning of each task's linked issue (the `task_issues` table) identical to the task (FR-089): its assignees, leaving off people with no linked GitHub account (FR-090); its parent, as the issue's parent issue; its blockers, as the issue's blocked-by relations; and a fixed-date milestone's date, as the due date of a GitHub milestone of its own that the issue is in, titled after the task and its issue number. A relation with a task that has no issue is left off GitHub, and one GitHub holds that the tool does not is removed. The service layer tells it of each change once it is committed, and it mirrors the changed tasks one at a time in the background; what fails is logged, for the re-check to put right (DD-051). The issues of tasks a project kept after its approval for their repository was withdrawn are left alone (FR-182).

Before mirroring a task, the mirror has the GitHub issue creator (SC-060, `backend/src/github/issue-creator.ts`) create its issue, titled after the task, if the task is assigned to a repository its project pulls from and has no issue yet (FR-088); a task gets at most one issue, and keeps it when assigned to another repository. After mirroring a cancelled task, the not-planned closer (SC-061, `backend/src/github/not-planned-closer.ts`) closes its issue with the reason "not planned" (FR-130), unless it is closed so already. The service layer tells the mirror of each assignment to a repository and each cancellation, and the re-check (`mirrorAll`) also takes in the tasks assigned to a repository whose issue could not be created.

### GitHub change handler

The GitHub change handler (SC-023, `backend/src/github/change-handler.ts`) takes in the changes made to linked issues on GitHub. It is told which issue changed and who changed it (`issueChanged`), or which was opened (`issueOpened`), by the webhook endpoint and the re-check (SC-105, SC-024), and reads the issue as it is now. It acts on what changed since it last took the issue in, kept as `seen_state` and `seen_status` in `task_issues`, so a change told twice is taken in once and a status set in the tool is not set back from an issue that has not changed on GitHub.

- A move in the configured status field to started starts the task, to on hold puts it on hold; closing the issue, or deleting it, finishes the task; closing it as not planned cancels it; reopening it sets a finished task back to in progress. These go through the service layer whatever the GitHub user's role, or none, and the audit log records them under the GitHub login of whoever made them (SRC-251), through the GitHub channel.
- A change the service layer refuses is reverted on GitHub: a start on a blocked task is reset to the option it had, a closed issue is reopened, a deleted one is created again and linked in its place.
- Planning edits made on GitHub (assignees, sub-issues, blocked-by) are undone by the planning mirror.
- A new issue becomes an unscheduled task, titled after it, in the repository's receiving project, or in the one project that pulls from the repository if it has no receiving project; in none otherwise.

### GitHub webhooks and the re-check

Changes made on GitHub reach the change handler in two ways (DD-051, DD-058, DD-060):

- **The webhook endpoint** (SC-105, `backend/src/api/github-webhooks.ts`, `backend/src/github/webhooks.ts`), `POST /api/github/webhooks`. Point a GitHub App's webhook, or a repository's or organization's, at it, with the content type `application/json` and a secret of your choosing, and give the tool the same secret: an App's as `github.apps.<function>.webhookSecret`, the one secret of every repository and organization webhook as `github.webhookSecret`. The endpoint needs no sign-in; it accepts a delivery only if its `X-Hub-Signature-256` matches the secret of whoever sent it (the App named by `X-GitHub-Hook-Installation-Target-ID`, or the repository and organization secret), and refuses any other with 401, without effect. Webhooks are optional: with no secret configured for a sender, its deliveries are refused. It takes in the events `issues`, `sub_issues`, `issue_dependencies` and `projects_v2_item` (the last only from an organization's Projects, found through a repository of that organization registered in the tool); subscribe the webhook to those. An accepted delivery is answered 202 at once and handled in the background; what fails is logged, for the re-check.
- **The re-check** (SC-024, `backend/src/github/recheck-timer.ts`, `backend/src/github/recheck.ts`) runs on a timer in the backend every `github.recheckIntervalMinutes` (60 unless set). It hands every linked issue to the change handler as if it had just changed, then has the planning mirror mirror every task again, which puts right what the mirror failed to write. The time of the last run is kept in `recheck_runs`, so a restart runs it at once only if it is due, and an advisory lock lets one backend instance run it at a time. A change the re-check finds is recorded under whoever GitHub names for it: the issue's closer, or whoever last reopened it; where GitHub names no one, for a deleted issue or a move in the Projects status field, under `(re-check)`, which no GitHub login can be.

### GitHub seeding importer

The GitHub seeding importer (SC-025, `backend/src/service/seeding.ts`) seeds a project from one or more repositories it pulls issues from, through `POST /api/projects/{projectId}/seeding`; only the project's admins may. It reads every issue of the chosen repositories from GitHub first (`backend/src/github/seeding-source.ts`), and only then writes them, in one transaction: if GitHub cannot be read, nothing is brought in (FR-137).

- An open issue becomes an unscheduled task: in progress if its Projects status field is in the started option, on hold if in the on-hold option, not started otherwise (the same settings as the change handler's). A closed issue becomes a done task, with the date GitHub records it was closed, in the backend's time zone, as its actual finish.
- Each task is assigned to the issue's repository and linked to the issue. Its assignees are the accounts linked to the issue's assignees on GitHub that can read the project; a sub-issue becomes a subtask, and a blocked-by relation one between the tasks.
- An issue that is a task already, in this project or another, or is blocked by an issue the import does not bring in, is skipped and listed in the answer. Pull requests are left out.
- Nothing is written to GitHub.

### Database schema

The schema is TypeScript in `backend/src/db/schema.ts` (DD-057). Each backend block adds its tables there, exported, since drizzle-kit sees only exported tables. After changing it, run `npm run db:generate -w backend` and commit the SQL migration it writes to `backend/drizzle/`, together with the change: a migration exists only as the change of the schema it is generated from, so write none by hand and edit none that is committed. If drizzle-kit asks whether a column or table was renamed, it needs a terminal to answer in.

Two checks keep the schema and the migrations in agreement (SC-073):

- `npm run db:check` generates a migration from the schema, with `backend/drizzle.config.ts` changed only in writing to a scratch copy of `backend/drizzle/`, and fails, naming what it would add, if that is anything, or if drizzle-kit could not generate (a schema that does not load, a rename it would have to ask about). It is part of `npm run check` and CI. It compares the schema with the migrations' snapshots, so it cannot see a committed migration edited by hand; the integration test below does.
- The integration test `backend/test/integration/schema-migrations.test.ts` applies every migration in order to an empty database and checks that the result has exactly the schema's tables and columns, that drizzle-kit finds nothing to change to make it match the schema (types, nullability, keys, indexes, enums), and that each migration is recorded as applied.

At start, before it serves any request, the backend applies the migrations the database has not recorded yet, with Drizzle's migrator (SC-074, `backend/src/db/migrate.ts`). It does this over one direct connection to `database.directUrl` (`database.url` if that is not set), which it closes again before it opens its pool on `database.url`, so a hosted database behind a pooler can be migrated. The pending migrations run in one transaction: if one fails, the tool's tables are left as they were (only Drizzle's own record of applied migrations, in the `drizzle` schema, may have been created), the backend prints why and exits, and the tool does not come up until the failure is fixed. A migrations folder without its journal, `backend/drizzle/meta/_journal.json`, is refused the same way, so the journal is committed even while it lists no migration. Migrations are not reversed; going back means restoring the backup taken before the upgrade (DD-057).

### CI and dependencies

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs format, lint, typecheck and `db:check`, the unit tests, the integration tests and the browser tests (each with a PostgreSQL 18 service), the build, and the Docker image's build and tests on every pull request and on `main`. On `main`, once every job has passed, it publishes the image to the GitHub Container Registry as `ghcr.io/csillagu/cold-seance`, for linux/amd64 and linux/arm64, tagged `latest` and `sha-<commit>`; there are no version tags (DD-040). The unit-test job adds a coverage table to the run's summary and keeps the HTML reports as the `coverage-report` artifact for 14 days. Coverage counts the unit tests only and has no minimum yet.
- [Dependabot](.github/dependabot.yml) proposes npm, GitHub Actions and Docker base image updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
