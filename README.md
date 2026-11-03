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

### Configuration

The backend reads its settings at start from a YAML file (DD-059): `config.yaml` in the directory it starts in, or the file named by `COLD_SEANCE_CONFIG_FILE`. [`backend/config.example.yaml`](backend/config.example.yaml) lists every setting. Each one can also be given by an environment variable, named after its path (`database.url` is `COLD_SEANCE_DATABASE_URL`, `github.apps.readIssues.appId` is `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID`), and **the environment variable wins over the file**; an empty variable counts as not set. A key in the file or a `COLD_SEANCE_` variable that is not a known setting stops the start, so a misspelt setting cannot go unnoticed. Without a file, the environment alone configures the tool.

The backend does not start if a required setting is missing, a value is not valid, or a GitHub App's key file cannot be read; it prints each such setting and exits. To run `npm run dev -w backend`, copy the example to `backend/config.yaml` and fill it in. `config.yaml` is ignored by git, because it holds secrets.

### Checks

| Command                           | What it runs                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Everything below except the integration tests: run it before you push                                 |
| `npm run format` / `format:check` | Prettier                                                                                              |
| `npm run lint`                    | oxlint, with type-aware rules                                                                         |
| `npm run typecheck`               | `tsc` in both packages                                                                                |
| `npm run db:check`                | Fails if the database schema has a change that no migration holds (SC-073)                            |
| `npm run test:unit`               | Vitest unit tests, both packages                                                                      |
| `npm run test:coverage`           | The unit tests with coverage: a summary in the terminal, an HTML report in each package's `coverage/` |
| `npm run test:integration`        | Backend integration tests against PostgreSQL                                                          |
| `npm run build`                   | Backend to `backend/dist/`, frontend to `frontend/dist/`                                              |

### Tests

- **Unit tests** sit next to the code they test, as `*.test.ts(x)` under `src/`. They need no database. Backend tests drive the HTTP layer with Fastify's `inject()`; frontend tests use Testing Library in jsdom.
- **Integration tests** are in `backend/test/integration/`. They run against a real PostgreSQL. `createTestDatabase()` in `backend/test/helpers/database.ts` gives each test file a fresh, empty database with every migration applied, matching the test cases' "fresh test deployment". Start a server and point the tests at it:

  ```sh
  docker compose -f compose.test.yaml up -d
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:integration
  ```

### REST API

The REST API (SC-026) is served under `/api`, in `backend/src/api/`. Each part of the service layer gets a route group, added to `routeGroups` in `backend/src/api/api.ts`. A route only translates the request and calls the service layer, passing it `callerOf(request)`; the rules, permission checks included, live in the service layer (DD-039), which refuses a request by throwing a `ServiceError` (`backend/src/service/errors.ts`). The API:

- refuses with 401, before the route runs, a request that no configured authenticator recognises (there is none yet, so every request is refused until the sign-in and token SCs add theirs); an unknown route under `/api` answers 401 too, and 404 only to an authenticated caller;
- refuses to start if a route lacks a success response schema that says what it sends (a `type`, and for an object its `properties` or a schema for its values), a body schema (POST, PUT, PATCH) or a params schema (a URL with parameters), so nothing goes out undescribed; a querystring schema is the route author's duty, as the guard cannot tell whether a route reads one;
- answers every error as `{ statusCode, error, message }`: a `ServiceError` as 400, 403, 404 or 409 with its message, a request Fastify itself refuses (schema, JSON, content type) with Fastify's status and message, and any other error, even one carrying a status of its own, as 500 with no detail, logged on the server.
- serves its OpenAPI description (SC-063) at `/api/openapi.json`, behind the same authentication. `@fastify/swagger` generates it from the routes' schemas as they are registered, so it always matches the running backend. So that it covers every route, the API refuses to start if a route would drop out of it or be described wrongly: a route with `hide: true` or the `X-HIDDEN` tag (only the description's own route is hidden), a route with a version constraint, a HEAD route declared by hand (the HEAD route Fastify adds for each GET is fine), or a shared schema `$id` added in two route groups with different content.

### Database schema

The schema is TypeScript in `backend/src/db/schema.ts` (DD-057). Each backend block adds its tables there. After changing it, run `npm run db:generate -w backend` and commit the SQL migration it writes to `backend/drizzle/`, together with the change: a migration exists only as the change of the schema it is generated from, so write none by hand and edit none that is committed. If drizzle-kit asks whether a column or table was renamed, it needs a terminal to answer in.

Two checks keep the schema and the migrations in agreement (SC-073):

- `npm run db:check` generates a migration from the schema into a scratch copy of `backend/drizzle/` and fails, naming what it would add, if that is anything. It is part of `npm run check` and CI.
- The integration test `backend/test/integration/schema-migrations.test.ts` applies every migration in order to an empty database and checks that the result has exactly the schema's tables and columns, with each migration recorded as applied.

### CI and dependencies

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs format, lint and typecheck, the unit tests, the integration tests (with a PostgreSQL 18 service) and the build on every pull request and on `main`. The unit-test job adds a coverage table to the run's summary and keeps the HTML reports as the `coverage-report` artifact for 14 days. Coverage counts the unit tests only and has no minimum yet.
- [Dependabot](.github/dependabot.yml) proposes npm and GitHub Actions updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
