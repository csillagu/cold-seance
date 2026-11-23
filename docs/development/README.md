# Development

This is the developer reference for cold-seance: how the repository is laid out, how to run it, the checks and tests, and how the pieces work inside. To use or install the tool, see the [user guide](../user-guide/README.md). To contribute, start with [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Item ids such as SC-073 or DD-040 name items of the requirements graph in [`graph/`](../../graph/), where the reason for each part is recorded.

| Document | What it covers |
| --- | --- |
| This page | The workspace, running it locally, checks, tests, parallel branches, the database schema |
| [Architecture](architecture.md) | The REST API, the MCP server and the GitHub components inside the backend |
| [Packaging and CI](packaging-and-ci.md) | The Docker image, the Windows package, CI, releases and code signing, dependencies |
| [Live tests and the test deployment](live-tests.md) | The Google Cloud test deployment, its demo projects and the live GitHub test suites |

## The workspace

The repository is one npm workspace with three packages, sharing one `package-lock.json`:

| Package                  | Stack                                                       |
| ------------------------ | ----------------------------------------------------------- |
| [`backend/`](../../backend/)   | Fastify on Node.js (DD-044), Drizzle on PostgreSQL (DD-057) |
| [`frontend/`](../../frontend/) | React, built with Vite (DD-045)                             |
| [`e2e/`](../../e2e/)           | The browser tests, with Playwright                          |

You need Node.js 26 (see [`.nvmrc`](../../.nvmrc); `nvm use` picks it up) and, for the integration tests, Docker or another PostgreSQL server.

```sh
npm ci                      # install exactly what package-lock.json records
npm run dev -w backend      # backend on http://localhost:3000, restarts on change
npm run dev -w frontend     # frontend dev server
```

The backend listens on `server.host` and `server.port` (127.0.0.1:3000 unless set). It also serves the built frontend, `frontend/dist/`, if there is one: its files as they are, and its `index.html` for any other GET outside `/api` and `/mcp`, since the frontend is a single-page application. Without a build it serves only the API and says so in its log.

## Configuration

The backend reads the same settings in development as in production; the user guide's [Configuration](../user-guide/configuration.md) describes each one, and [`backend/config.example.yaml`](../../backend/config.example.yaml) lists them (DD-059, DD-060). To run `npm run dev -w backend`, copy the example to `backend/config.yaml` and fill it in: at least `database.url` and a GitHub App or token for each GitHub function, which may belong to a test App or account. `config.yaml` is ignored by git, because it holds secrets.

## Checks

| Command                           | What it runs                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Everything below except the integration tests: run it before you push                                                                                     |
| `npm run format` / `format:check` | Prettier                                                                                                                                                  |
| `npm run lint`                    | oxlint, with type-aware rules                                                                                                                             |
| `npm run typecheck`               | `tsc` in both packages                                                                                                                                    |
| `npm run db:check`                | Fails if the database schema has a change that no migration holds (SC-073)                                                                                |
| `npm run test:unit`               | Vitest unit tests, both packages                                                                                                                          |
| `npm run test:coverage`           | The unit tests with coverage: a summary in the terminal, an HTML report in each package's `coverage/`                                                     |
| `npm run test:integration`        | Backend integration tests against PostgreSQL                                                                                                              |
| `npm run test:e2e`                | Browser tests: builds the frontend, then runs Playwright against the backend serving it, on PostgreSQL                                                    |
| `npm run test:image`              | Tests of the Docker image (SC-028) and the Compose file (SC-029), against PostgreSQL; needs Docker and a built image                                      |
| `npm run test:windows`            | Tests of the Windows zip (SC-120 to SC-122), on Windows only, against PostgreSQL; needs the zip unpacked, named by `TEST_WINDOWS_PACKAGE`                 |
| `npm run test:live`               | The live GitHub tests (SC-126), against the test deployment and a real repository; needs the `LIVE_` variables of [Live GitHub tests](live-tests.md#live-github-tests) |
| `npm run test:live:local`         | The same live GitHub tests (SC-128) against a backend the run starts itself, on PostgreSQL; see [Live GitHub tests](live-tests.md#live-github-tests)                   |
| `npm run build`                   | Backend to `backend/dist/`, frontend to `frontend/dist/`                                                                                                  |

## Parallel branches

Many branches are open at once. Before a branch is merged, `npm run db:rebase` brings it up to date: it fetches `origin/main`, rebases onto it, and generates the branch's migration again after `main`'s, in one commit. Two branches' migrations would otherwise share a number and a journal, and merging them by hand risks a migration that existing databases skip. New tables go in a schema module of their own under `backend/src/db/schema/`, re-exported from `backend/src/db/schema.ts`; `CLAUDE.md` lists the other habits that keep branches from colliding.

## Tests

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

## Database schema

The schema is TypeScript in `backend/src/db/schema.ts` (DD-057). Each backend block adds its tables there, exported, since drizzle-kit sees only exported tables. After changing it, run `npm run db:generate -w backend` and commit the SQL migration it writes to `backend/drizzle/`, together with the change: a migration exists only as the change of the schema it is generated from, so write none by hand and edit none that is committed. If drizzle-kit asks whether a column or table was renamed, it needs a terminal to answer in.

Two checks keep the schema and the migrations in agreement (SC-073):

- `npm run db:check` generates a migration from the schema, with `backend/drizzle.config.ts` changed only in writing to a scratch copy of `backend/drizzle/`, and fails, naming what it would add, if that is anything, or if drizzle-kit could not generate (a schema that does not load, a rename it would have to ask about). It is part of `npm run check` and CI. It compares the schema with the migrations' snapshots, so it cannot see a committed migration edited by hand; the integration test below does.
- The integration test `backend/test/integration/schema-migrations.test.ts` applies every migration in order to an empty database and checks that the result has exactly the schema's tables and columns, that drizzle-kit finds nothing to change to make it match the schema (types, nullability, keys, indexes, enums), and that each migration is recorded as applied.

At start, before it serves any request, the backend applies the migrations the database has not recorded yet, with Drizzle's migrator (SC-074, `backend/src/db/migrate.ts`). It does this over one direct connection to `database.directUrl` (`database.url` if that is not set), which it closes again before it opens its pool on `database.url`, so a hosted database behind a pooler can be migrated. The pending migrations run in one transaction: if one fails, the tool's tables are left as they were (only Drizzle's own record of applied migrations, in the `drizzle` schema, may have been created), the backend prints why and exits, and the tool does not come up until the failure is fixed. A migrations folder without its journal, `backend/drizzle/meta/_journal.json`, is refused the same way, so the journal is committed even while it lists no migration. Migrations are not reversed; going back means restoring the backup taken before the upgrade (DD-057).
