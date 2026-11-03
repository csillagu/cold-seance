# cold-seance

The requirements live in [`graph/`](graph/) (a [reqlite](https://github.com/major-solutions/reqlite) graph) and the build order in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Development

The repository is one npm workspace with two packages, sharing one `package-lock.json`:

| Package                  | Stack                                                       |
| ------------------------ | ----------------------------------------------------------- |
| [`backend/`](backend/)   | Fastify on Node.js (DD-044), Drizzle on PostgreSQL (DD-057) |
| [`frontend/`](frontend/) | React, built with Vite (DD-045)                             |

You need Node.js 26 (see [`.nvmrc`](.nvmrc); `nvm use` picks it up) and, for the integration tests, Docker or another PostgreSQL server.

```sh
npm ci                      # install exactly what package-lock.json records
npm run dev -w backend      # backend on http://localhost:3000, restarts on change
npm run dev -w frontend     # frontend dev server
```

The backend listens on `server.host` and `server.port` (127.0.0.1:3000 unless set). It also serves the built frontend, `frontend/dist/`, if there is one: its files as they are, and its `index.html` for any other GET outside `/api`, since the frontend is a single-page application. Without a build it serves only the API and says so in its log.

### Configuration

The backend reads its settings at start from a YAML file (DD-059): `config.yaml` in the directory it starts in, or the file named by `COLD_SEANCE_CONFIG_FILE`. [`backend/config.example.yaml`](backend/config.example.yaml) lists every setting. Each one can also be given by an environment variable, named after its path (`database.url` is `COLD_SEANCE_DATABASE_URL`, `github.apps.readIssues.appId` is `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID`), and **the environment variable wins over the file**; an empty variable counts as not set. A key in the file or a `COLD_SEANCE_` variable that is not a known setting stops the start, so a misspelt setting cannot go unnoticed. Without a file, the environment alone configures the tool.

The backend does not start if a required setting is missing, a value is not valid, or a GitHub App's key file cannot be read; it prints each such setting and exits. To run `npm run dev -w backend`, copy the example to `backend/config.yaml` and fill it in. `config.yaml` is ignored by git, because it holds secrets.

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
| `npm run test:image`              | Tests of the Docker image (SC-028) and the Compose file (SC-029), against PostgreSQL; needs Docker and a built image |
| `npm run build`                   | Backend to `backend/dist/`, frontend to `frontend/dist/`                                                             |

### Tests

- **Unit tests** sit next to the code they test, as `*.test.ts(x)` under `src/` (and `backend/scripts/`). They need no database. Backend tests drive the HTTP layer with Fastify's `inject()`; frontend tests use Testing Library in jsdom.
- **Integration tests** are in `backend/test/integration/`. They run against a real PostgreSQL. `createTestDatabase()` in `backend/test/helpers/database.ts` gives each test file a fresh, empty database with every migration applied, matching the test cases' "fresh test deployment". Start a server and point the tests at it:

  ```sh
  docker compose -f compose.test.yaml up -d
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:integration
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

[`compose.yaml`](compose.yaml) is the tool's installation (SC-029, DD-040): the application image next to the official PostgreSQL 18 image, which keeps its data in the Compose volume `database`. In a directory holding `compose.yaml` (and, until the image is published, the repository to build it from):

```sh
cp .env.example .env                          # set POSTGRES_PASSWORD in it
cp backend/config.example.yaml config.yaml    # fill in the GitHub Apps; leave database.url out
mkdir secrets && cp <key files> secrets/      # mounted at /run/secrets
docker compose up -d
```

- `config.yaml` and `secrets/` are mounted read-only and must exist; the start fails rather than mount empty directories in their place. They and `.env` hold secrets: make them readable by the `node` user (uid 1000) and no one else.
- The tool is published on `127.0.0.1:3000`, this machine only. `COLD_SEANCE_PUBLISH` in `.env` changes that, for example to `0.0.0.0:3000`. The database is not published at all.
- Under Compose the database address comes from `COLD_SEANCE_DATABASE_URL` in `.env`, the bundled database's if it is not set. As the environment wins over the file (DD-059), `database.url` in `config.yaml` has no effect here.
- To use an existing or hosted PostgreSQL instead (FR-177), set `COLD_SEANCE_DATABASE_URL` (and `COLD_SEANCE_DATABASE_DIRECT_URL` behind a pooler) in `.env` and start the application alone: `docker compose up -d --no-deps app`. `POSTGRES_PASSWORD` is then not needed.
- **The volume is the data.** `docker compose down --volumes`, or removing the volume, deletes everything. Back it up with `docker compose exec database pg_dump -U cold_seance cold_seance > backup.sql`. The PostgreSQL major version is fixed in `compose.yaml`; moving to a new one needs a dump and a restore, which Compose does not do.

The image tests (`npm run test:image`, above) also run the Compose file from a scratch install directory: with its bundled database, and with an external one while the bundled one is stopped.

### REST API

The REST API (SC-026) is served under `/api`, in `backend/src/api/`. Each part of the service layer gets a route group, added to `routeGroups` in `backend/src/api/api.ts`. A route only translates the request and calls the service layer, passing it `callerOf(request)`; the rules, permission checks included, live in the service layer (DD-039), which refuses a request by throwing a `ServiceError` (`backend/src/service/errors.ts`). The API:

- refuses with 401, before the route runs, a request that no configured authenticator recognises (there is none yet, so every request is refused until the sign-in and token SCs add theirs); an unknown route under `/api` answers 401 too, and 404 only to an authenticated caller;
- refuses to start if a route lacks a success response schema that says what it sends (a `type`, and for an object its `properties` or a schema for its values), a body schema (POST, PUT, PATCH) or a params schema (a URL with parameters), so nothing goes out undescribed; a querystring schema is the route author's duty, as the guard cannot tell whether a route reads one;
- answers every error as `{ statusCode, error, message }`: a `ServiceError` as 400, 403, 404 or 409 with its message, a request Fastify itself refuses (schema, JSON, content type) with Fastify's status and message, and any other error, even one carrying a status of its own, as 500 with no detail, logged on the server.
- serves its OpenAPI description (SC-063) at `/api/openapi.json`, behind the same authentication. `@fastify/swagger` generates it from the routes' schemas as they are registered, so it always matches the running backend. So that it covers every route, the API refuses to start if a route would drop out of it or be described wrongly: a route with `hide: true` or the `X-HIDDEN` tag (only the description's own route is hidden), a route with a version constraint, a HEAD route declared by hand (the HEAD route Fastify adds for each GET is fine), or a shared schema `$id` added in two route groups with different content.

### Database schema

The schema is TypeScript in `backend/src/db/schema.ts` (DD-057). Each backend block adds its tables there, exported, since drizzle-kit sees only exported tables. After changing it, run `npm run db:generate -w backend` and commit the SQL migration it writes to `backend/drizzle/`, together with the change: a migration exists only as the change of the schema it is generated from, so write none by hand and edit none that is committed. If drizzle-kit asks whether a column or table was renamed, it needs a terminal to answer in.

Two checks keep the schema and the migrations in agreement (SC-073):

- `npm run db:check` generates a migration from the schema, with `backend/drizzle.config.ts` changed only in writing to a scratch copy of `backend/drizzle/`, and fails, naming what it would add, if that is anything, or if drizzle-kit could not generate (a schema that does not load, a rename it would have to ask about). It is part of `npm run check` and CI. It compares the schema with the migrations' snapshots, so it cannot see a committed migration edited by hand; the integration test below does.
- The integration test `backend/test/integration/schema-migrations.test.ts` applies every migration in order to an empty database and checks that the result has exactly the schema's tables and columns, that drizzle-kit finds nothing to change to make it match the schema (types, nullability, keys, indexes, enums), and that each migration is recorded as applied.

At start, before it serves any request, the backend applies the migrations the database has not recorded yet, with Drizzle's migrator (SC-074, `backend/src/db/migrate.ts`). It does this over one direct connection to `database.directUrl` (`database.url` if that is not set), which it closes again before it opens its pool on `database.url`, so a hosted database behind a pooler can be migrated. The pending migrations run in one transaction: if one fails, the tool's tables are left as they were (only Drizzle's own record of applied migrations, in the `drizzle` schema, may have been created), the backend prints why and exits, and the tool does not come up until the failure is fixed. A migrations folder without its journal, `backend/drizzle/meta/_journal.json`, is refused the same way, so the journal is committed even while it lists no migration. Migrations are not reversed; going back means restoring the backup taken before the upgrade (DD-057).

### CI and dependencies

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs format, lint, typecheck and `db:check`, the unit tests, the integration tests (with a PostgreSQL 18 service), the build, and the Docker image's build and tests on every pull request and on `main`. The unit-test job adds a coverage table to the run's summary and keeps the HTML reports as the `coverage-report` artifact for 14 days. Coverage counts the unit tests only and has no minimum yet.
- [Dependabot](.github/dependabot.yml) proposes npm, GitHub Actions and Docker base image updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
