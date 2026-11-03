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

### Database schema

The schema is TypeScript in `backend/src/db/schema.ts`. After changing it, run `npm run db:generate -w backend` and commit the SQL migration it writes to `backend/drizzle/`.

### CI and dependencies

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs format, lint and typecheck, the unit tests, the integration tests (with a PostgreSQL 18 service) and the build on every pull request and on `main`. The unit-test job adds a coverage table to the run's summary and keeps the HTML reports as the `coverage-report` artifact for 14 days. Coverage counts the unit tests only and has no minimum yet.
- [Dependabot](.github/dependabot.yml) proposes npm and GitHub Actions updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
