# cold-seance

cold-seance is a self-hosted, open-source project planning tool for teams that work on GitHub. The tool holds the plan: tasks, subtasks, blocked-by relations, milestones, assignments and dates. It mirrors that plan to the linked GitHub issues, and GitHub can only start, hold and finish tasks.

- **Views:** Kanban, Gantt (with constraint violations in red and optional baseline bars), the load of each person across projects, baseline variance, and an inbox of unscheduled tasks created from GitHub issues.
- **Scheduling:** within a project, a change to one task's dates moves the tasks that depend on it. A clash across projects is flagged for the owners to resolve and never changes the other project.
- **AI proposes, people approve:** a REST API and an MCP server let an AI assistant read the plan and propose changes. A person reviews each proposal in the browser before it is applied.
- **GitHub:** each task can have a linked issue. The tool keeps the issue's assignees, sub-issues, blocked-by relations and milestone in line with the task, and reads starts, holds and closes back from GitHub, through webhooks and a periodic re-check.

> **Status:** under active development. Not every feature described in the requirements is built yet; the [implementation plan](docs/implementation-plan.md) records what is.

- **Install:** with Docker Compose, the published image `ghcr.io/csillagu/cold-seance` and PostgreSQL; see [Installing with Docker Compose](#installing-with-docker-compose). Or natively on Windows, from a portable zip, with a PostgreSQL you install; see [Installing on Windows](#installing-on-windows).
- **Configure:** a YAML file or environment variables, with a GitHub App or a personal access token for each GitHub function; see [Configuration](#configuration) and [`backend/config.example.yaml`](backend/config.example.yaml).
- **Contribute:** see [`CONTRIBUTING.md`](CONTRIBUTING.md). To report a vulnerability, see [`SECURITY.md`](SECURITY.md).
- **License:** [Apache License 2.0](LICENSE).

## How the project is organised

The requirements live in [`graph/`](graph/) (a [reqlite](https://github.com/major-solutions/reqlite) graph). Two documents order the work:

- [`docs/implementation-plan.md`](docs/implementation-plan.md), the **implementation plan**: every solution component in build order, in waves, with the status of each. It is the record of what is done.
- [`plan/work-graph.md`](plan/work-graph.md), the **parallel work graph**: the components not yet built, cut into issue-sized nodes with "blocked by" relations, so that several people or agents can work at once. Its data is in [`plan/work-graph.yaml`](plan/work-graph.yaml). [`plan/create-issues.py`](plan/create-issues.py) turns it into GitHub issues, and agents take them one at a time as [`plan/agent-prompt.md`](plan/agent-prompt.md) sets out.

Much of the code is written by AI coding agents (Claude Code) working on those issues; [`CLAUDE.md`](CLAUDE.md) holds the rules they follow. [`docs/initial-requirements.md`](docs/initial-requirements.md) is the stakeholder's original input, kept frozen, and [`design/`](design/) holds the approved look of the frontend.

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

The backend listens on `server.host` and `server.port` (127.0.0.1:3000 unless set). It also serves the built frontend, `frontend/dist/`, if there is one: its files as they are, and its `index.html` for any other GET outside `/api` and `/mcp`, since the frontend is a single-page application. Without a build it serves only the API and says so in its log.

### Configuration

The backend reads its settings at start from a YAML file (DD-059): `config.yaml` in the directory it starts in, or the file named by `COLD_SEANCE_CONFIG_FILE`. [`backend/config.example.yaml`](backend/config.example.yaml) lists every setting. Each one can also be given by an environment variable, named after its path (`database.url` is `COLD_SEANCE_DATABASE_URL`, `github.apps.readIssues.appId` is `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID`), and **the environment variable wins over the file**; an empty variable counts as not set. A key in the file or a `COLD_SEANCE_` variable that is not a known setting stops the start, so a misspelt setting cannot go unnoticed. Without a file, the environment alone configures the tool.

Each GitHub function (reading issues, writing to issues, the Projects status field) is given either a GitHub App, under `github.apps.<function>`, or a personal access token, under `github.tokens.<function>` (DD-060); Apps and tokens can be mixed across functions, and one can serve several. A token is given as its value, so an environment variable such as `COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES` can keep it out of the file; the function must then not also be given an App under `github.apps`, in the file or the environment, or the two count as both. `github.webhookSecret` is the one secret of the webhooks set up on repositories and organizations, if any are used.

Start and hold are read from a GitHub Projects status field (DD-015), in whichever Project an issue is in: `github.statusField.name` names the field (`Status` unless set), `github.statusField.started` and `github.statusField.onHold` its options for started and on hold (`In Progress` and `On Hold` unless set), so a deployment of the Docker image sets them with `COLD_SEANCE_GITHUB_STATUS_FIELD_NAME`, `COLD_SEANCE_GITHUB_STATUS_FIELD_STARTED` and `COLD_SEANCE_GITHUB_STATUS_FIELD_ON_HOLD` (SRC-252). Option names are compared ignoring case.

The first system admin is given by `COLD_SEANCE_FIRST_ADMIN_USERNAME` and `COLD_SEANCE_FIRST_ADMIN_PASSWORD` (FR-165), together or not at all. At start, while no system admin exists, the backend creates that account as a system admin; sign in with it and create everyone else's account. Once a system admin exists, the two change nothing. The backend does not start if they name a username or password no account could have, or a username an account that is not a system admin already has.

A task's actual start and finish are recorded as the date of the day it is started or finished, in the backend's local time zone. Set it with the standard `TZ` environment variable, such as `TZ=Europe/Budapest`; without it the Docker image uses UTC.

The backend does not start if a required setting is missing, a value is not valid, a GitHub App's key file cannot be read, or a GitHub function is given both an App and a token, or neither; it prints each such setting or function and exits. To run `npm run dev -w backend`, copy the example to `backend/config.yaml` and fill it in. `config.yaml` is ignored by git, because it holds secrets.

### Checks

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
| `npm run test:live`               | The live GitHub tests (SC-126), against the test deployment and a real repository; needs the `LIVE_` variables of [Live GitHub tests](#live-github-tests) |
| `npm run build`                   | Backend to `backend/dist/`, frontend to `frontend/dist/`                                                                                                  |

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
- Docker Desktop's licence asks larger organisations (more than 250 employees or $10 million in annual revenue) for a paid subscription. Free ways to run the Compose file are Docker Engine, which is open source, on Linux, and [Podman Desktop](https://podman-desktop.io/) or [Rancher Desktop](https://rancherdesktop.io/) on Windows and macOS (DD-040). On Windows the tool can also run without Docker: see [Installing on Windows](#installing-on-windows).
- **The volume is the data.** `docker compose down --volumes`, or removing the volume, deletes everything. Back it up with `docker compose exec -T database pg_dump -U cold_seance cold_seance > backup.sql`, and restore it into an empty volume with `docker compose exec -T database psql -U cold_seance -d cold_seance < backup.sql`. The PostgreSQL major version is fixed in `compose.yaml`; moving to a new one needs a dump and a restore, which Compose does not do.

The image tests (`npm run test:image`, above) also run the Compose file from a scratch install directory, with the image under test in place of the published one: with its bundled database, and with an external one while the bundled one is stopped.

### Installing on Windows

The Windows portable zip (SC-120, DD-061) runs the tool natively on Windows, with no Docker, WSL or other virtualization. It holds Node.js's Windows runtime, the tool, a start script, an optional Windows service (SC-121) and a backup script (SC-122). Everything in it is open source and free. Download `cold-seance-<version>-windows-x64.zip` from the repository's [Releases](https://github.com/csillagu/cold-seance/releases); each version tag publishes one (SC-124).

1. **PostgreSQL.** Install PostgreSQL with the free Windows installer from [postgresql.org](https://www.postgresql.org/download/windows/), or use one you already have, a hosted one included (FR-177). The installer also brings `pg_dump`, `pg_restore`, `psql` and pgAdmin. Create the tool's database, in pgAdmin or in psql as `postgres`:

   ```sql
   CREATE ROLE cold_seance LOGIN PASSWORD 'choose-a-password';
   CREATE DATABASE cold_seance OWNER cold_seance;
   ```

2. **Unpack** the zip into a folder of its own, such as `C:\cold-seance`; any folder works, `C:\Program Files` included. Until the zip is signed, Windows may warn about files from the internet: open the zip's Properties and tick **Unblock** before unpacking it.
3. **Configure.** In that folder, copy `config.example.yaml` to `config.yaml` and fill it in, as [Configuration](#configuration) describes: at least `database.url` (`postgres://cold_seance:choose-a-password@localhost:5432/cold_seance`) and the GitHub settings. Write a Windows path in single quotes, such as `privateKeyFile: 'C:\cold-seance\secrets\github-app.pem'`: in double quotes a backslash starts an escape.
4. **Restrict** `config.yaml` and the key files, which hold secrets, to the accounts that run the tool. From a command prompt in the folder, as an administrator:

   ```bat
   icacls config.yaml /inheritance:r /grant:r "SYSTEM:R" "Administrators:F" "%USERNAME%:R"
   icacls secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)R" "Administrators:(OI)(CI)F" "%USERNAME%:(OI)(CI)R"
   ```

   `SYSTEM` is the account the service runs as; leave out `%USERNAME%` if you only run the tool as a service.

5. **Start** it with `start.cmd`. It applies the pending migrations to the database (SC-074) and serves the tool on <http://127.0.0.1:3000>. Ctrl+C stops it cleanly; the command prompt then asks whether to terminate the batch job, and either answer is fine.

- The tool listens on this machine only. To let other machines reach it, set `server.host` to `0.0.0.0` and allow port 3000 in Windows Firewall: the tool is then open to the whole network the machine is on.
- Actual start and finish dates use Windows' time zone; the `TZ` environment variable overrides it.
- **Updating:** stop the tool and take a backup. Delete everything in the folder except `config.yaml`, your key files, the password file and the logs, then unpack the new zip's contents in its place and start the tool, which migrates the database. A service registered from the folder stays registered.

#### As a Windows service

Registering the tool as a Windows service, which starts at boot, is optional (SC-121). The service wrapper is [WinSW](https://github.com/winsw/winsw), shipped as `cold-seance-service.exe` and set up by `cold-seance-service.xml`. From a command prompt in the folder, as an administrator:

```bat
cold-seance-service.exe install
cold-seance-service.exe start
```

`stop`, `restart`, `status` and `uninstall` do what they say; the Services console works too. The service runs the tool from its folder, so it reads `config.yaml` from there. It gets no environment variables but those set in `cold-seance-service.xml`, such as `<env name="TZ" value="Europe/Budapest" />`. Its output goes to `cold-seance-service.out.log` and `.err.log` in the folder. When the service is stopped, the wrapper sends the tool Ctrl+C, and the tool closes cleanly; it is stopped by force only if it has not ended within 30 seconds.

The service runs as `LocalSystem`, which can do anything on the machine. A flaw in the tool reached through the network would have that reach, so keep the tool on this machine only unless you need otherwise.

#### Backing up on Windows

The tool does not back itself up: the backups are yours (SC-122, DD-061). A dump of the database holds all of the tool's data. It does **not** hold `config.yaml`, the GitHub App key files or the PostgreSQL password file. Copy those somewhere safe yourself, once and after each change.

**Nightly backups** with `backup.ps1`:

1. **A password file.** `pg_dump` takes the password from PostgreSQL's password file, so none is written in the script or the scheduled task. The task below runs as `SYSTEM`, so give it a file of its own: create `C:\cold-seance\pgpass.conf` holding one line, `localhost:5432:cold_seance:cold_seance:choose-a-password` (host, port, database, user and password), and restrict it:

   ```bat
   icacls C:\cold-seance\pgpass.conf /inheritance:r /grant:r "SYSTEM:R" "Administrators:F"
   ```

   Without `-PassFile`, `pg_dump` reads the running user's own `%APPDATA%\postgresql\pgpass.conf`.

2. **Schedule it** every night at 02:00, from a command prompt as an administrator. Put the backup folder on another disk, or copy it off the machine:

   ```bat
   schtasks /Create /TN "cold-seance backup" /SC DAILY /ST 02:00 /RU SYSTEM /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\cold-seance\backup.ps1 -Folder D:\backups\cold-seance -PassFile C:\cold-seance\pgpass.conf"
   ```

   A path with spaces is quoted as `\"C:\Program Files\cold-seance\backup.ps1\"` inside `/TR`. Each run writes `cold_seance-<date>-<time>.dump` in the folder and deletes that database's dumps there older than 7 days (`-KeepDays` changes it). `-Database`, `-User`, `-Server`, `-Port` and `-PgDump` override `cold_seance`, `cold_seance`, `localhost`, `5432` and the `pg_dump` it finds on `PATH` or in `C:\Program Files\PostgreSQL`. `Get-Help .\backup.ps1 -Full` describes them.

3. **Run it once now**, with `schtasks /Run /TN "cold-seance backup"`, and check that a dump appears.

**Check on it.** The tool knows nothing of its backups, so a failing backup goes unnoticed unless you look. A failed run ends with a non-zero code, which Task Scheduler shows as the task's Last Run Result (anything but `0x0`), and `schtasks /Query /TN "cold-seance backup" /V /FO LIST` prints. Look at it, and at the dumps folder, from time to time.

**By hand,** from PostgreSQL's `bin` folder (`C:\Program Files\PostgreSQL\<version>\bin`): `pg_dump -Fc -h localhost -U cold_seance -f cold_seance.dump cold_seance`. In pgAdmin, right-click the database and choose **Backup…**, with the Custom format, and **Restore…** to restore.

**Restoring** a dump:

1. Stop the tool (Ctrl+C, or `cold-seance-service.exe stop`).
2. Create an empty database, as `postgres`: `CREATE DATABASE cold_seance_restored OWNER cold_seance;`
3. Restore into it: `pg_restore --no-owner -h localhost -U cold_seance -d cold_seance_restored D:\backups\cold-seance\cold_seance-<date>-<time>.dump`. A plain SQL dump, made without `-Fc`, is restored with `psql -h localhost -U cold_seance -d cold_seance_restored -f <file>` instead.
4. Point `database.url` at the restored database, or drop the old one and rename it (`DROP DATABASE cold_seance; ALTER DATABASE cold_seance_restored RENAME TO cold_seance;`), and start the tool.

**Test a restore once:** restore a dump into a scratch database as above, start the tool on it, and check that your projects are there. A backup that was never restored may not restore.

### Test deployment on Google Cloud

The project's own test deployment (SC-125, DD-062), which the live GitHub tests below run against, is described by Terraform scripts in [`deploy/gcp/`](deploy/gcp/). It is a test bed for the project, not a way to install the tool: it runs the published image on Google Cloud Run, scaled to zero, with its database on Neon's free plan, so it costs next to nothing between test runs. Terraform also puts a webhook on the test repository and writes the live tests' settings into this repository's `live` environment. Nothing is deployed from CI; apply the scripts from your own machine.

**Before the first apply**, on GitHub:

1. Create the test repository, `csillagu/cold-seance-live` unless you set `test_repository`. Use it for these tests only: the suite creates and deletes issues and milestones in it.
2. Register a GitHub App by hand (DD-058) with the repository permissions **Issues: read and write** and **Metadata: read**, and with its webhook turned off: the deployment takes its webhook deliveries from the test repository's webhook, which Terraform sets up. Install the App on the test repository only, and generate a private key.
3. Create a GitHub Project owned by your user, with a single-select field `Status` whose options include `In Progress` and `On Hold`. Note its number, from its address.
4. Create the tokens. A fine-grained token cannot reach a Project owned by a user or read GitHub Packages, so the tokens for those are classic:
   - **The Projects token** (`github_projects_token`): classic, with the `repo` and `project` scopes. The deployment reads the status field with it (`projectsStatus`), and the live tests set it.
   - **The live tests' token** (`live_github_token`): fine-grained, on the test repository only, with **Issues: read and write**, **Metadata: read** and **Administration: read and write**. Only a repository admin can delete an issue, and GitHub's documentation does not say which fine-grained permission that takes, so give Administration on the dedicated test repository.
   - **The registry token** (`ghcr_token`): classic, with only the `read:packages` scope. The image is private, Cloud Run pulls it through an Artifact Registry proxy of `ghcr.io`, and a fine-grained token cannot read GitHub Packages.
   - **Terraform's own token**, in the environment variable `GITHUB_TOKEN`: fine-grained, on `cold-seance` and the test repository, with **Administration**, **Environments**, **Secrets**, **Variables** and **Webhooks**, all read and write. Or `gh auth token`, if `gh` is signed in as the owner.

Then, with [Terraform](https://developer.hashicorp.com/terraform/install) 1.9 or later, the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) signed in (`gcloud auth application-default login`), a Google Cloud project with billing enabled (the free tier still needs a billing account) and a [Neon API key](https://neon.com/docs/manage/api-keys):

```sh
cd deploy/gcp
cp terraform.tfvars.example terraform.tfvars   # fill it in; it is ignored by git
export NEON_API_KEY=...
export GITHUB_TOKEN=...                        # or: export GITHUB_TOKEN=$(gh auth token)
terraform init
terraform apply
terraform output url                           # the deployment's address
terraform output -raw admin_password           # the first system admin's, generated by Terraform
```

The deployment's address is the one Cloud Run gives the service, `https://<name>-<project number>.<region>.run.app`, with Cloud Run's own certificate; it stays the same for as long as the service exists.

What Terraform makes:

- **The Cloud Run service**, scaled to zero and to one instance. Its CPU stays allocated while an instance is up, not only during a request, so that the re-check runs and webhook deliveries are handled after they are answered. An instance starts at the first call and stops some minutes after the last, so it runs through a test run and not between runs. The first call after a pause waits for the tool to start.
- **The registry proxy**, an Artifact Registry repository of `ghcr.io`, which signs in with the registry token and keeps a copy of the image for a month.
- **Two Secret Manager secrets**: the App's private key, mounted into the service as a file, and the registry token. The other settings are the service's environment variables.

- **The first system admin's password and the webhook secret**, generated once and kept in Terraform's state.
- **The test repository's webhook**, pointed at `terraform output webhook_url`, with the events `issues`, `sub_issues` and `issue_dependencies` and the generated secret, which the deployment is given as `github.webhookSecret`. GitHub sends no webhook for a Project owned by a user, so a change to the status field still comes in through the re-check, every 2 minutes here (`recheck_interval_minutes`).
- **The `live` environment** of `cold-seance`, with every setting of the [live GitHub tests](#live-github-tests): the address, the admin's name, the test repository, the Project, the status field, the time zone and the wait as its variables, and the admin's password and the two tokens as its secrets.

Running it:

- **Updating to the latest image**: Cloud Run fixes the image's version when it makes a revision. Run the command `terraform output update` prints to make a new one with the latest image. A change to the variables makes a new revision at `terraform apply`.
- **Between test runs** nothing runs, and Neon's database sleeps too. A webhook delivery then starts an instance, but GitHub gives up on a delivery after 10 seconds, so one may be lost while the tool starts; a change to the status field made between runs is seen at the next run's re-check.
- **Logs**: `terraform output logs` prints the command that shows them; they are also in the Google Cloud console, under the service.
- **Secrets**: the service's environment variables can be read by the Google Cloud project's users. Terraform's state, `terraform.tfstate`, holds every secret in plain text: keep it on your machine, or in a private bucket, and never commit it.
- **Cost**: Cloud Run is billed only while an instance is up, within a monthly free tier; Artifact Registry and Secret Manager have free allowances that the copy of the image and the two secrets fit in. A budget alert on the project (Billing, Budgets & alerts) tells you if that stops being true.
- **Removing it**: `terraform destroy` deletes the service, the registry proxy and the secrets, the Neon project with all its data, the test repository's webhook and the `live` environment.

### Live GitHub tests

`npm run test:live` runs the GitHub steps of the test cases against the test deployment and the real test repository (SC-126, DD-062), where the integration tests use a fake of GitHub. The tests are in `backend/test/live/`, each named with its test case's id. Each run works in projects of its own, named after it, on the deployment, and when it ends it removes the test repository from them and deletes the issues and milestones it made on GitHub. The projects stay, since the tool cannot delete a project. A change made to an issue on GitHub reaches the deployment through the webhook, in seconds; a change to the Projects status field only at its next re-check, which those tests wait for: a run takes several minutes.

Terraform writes every one of these settings into the `live` environment. To run the suite from your machine, take them from there or from `terraform output`:

| Variable                                                                           | What it is                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_URL`                                                                         | The deployment's address (`terraform output url`)                                                                                               |
| `LIVE_ADMIN_USERNAME`                                                              | Its first system admin (`root` unless set), whom the tests act as in the tool. The tests link this account to `LIVE_GITHUB_TOKEN`'s GitHub user |
| `LIVE_ADMIN_PASSWORD`                                                              | Their password (`terraform output -raw admin_password`)                                                                                         |
| `LIVE_GITHUB_REPOSITORY`                                                           | The test repository, `owner/name`                                                                                                               |
| `LIVE_GITHUB_TOKEN`                                                                | The live tests' fine-grained token, standing for the GitHub users the test cases name                                                           |
| `LIVE_GITHUB_PROJECTS_TOKEN`                                                       | The classic Projects token, which the tests set the status field with                                                                           |
| `LIVE_GITHUB_PROJECT_NUMBER`                                                       | The number of the GitHub Project with the status field                                                                                          |
| `LIVE_GITHUB_PROJECT_OWNER`                                                        | Its owner, the repository's owner unless set                                                                                                    |
| `LIVE_STATUS_FIELD_NAME`, `LIVE_STATUS_FIELD_STARTED`, `LIVE_STATUS_FIELD_ON_HOLD` | The status field and its options, if not `Status`, `In Progress` and `On Hold`: the same as the deployment's `status_field`                     |
| `LIVE_TIMEZONE`                                                                    | The deployment's time zone (`timezone`), `UTC` unless set                                                                                       |
| `LIVE_WAIT_MINUTES`                                                                | How long a test waits for a change made on GitHub to reach the deployment, 6 unless set: three times the deployment's re-check interval         |

```sh
LIVE_URL=https://cold-seance-test-123456789012.us-east1.run.app LIVE_ADMIN_PASSWORD=... LIVE_GITHUB_REPOSITORY=csillagu/cold-seance-live \
  LIVE_GITHUB_TOKEN=github_pat_... LIVE_GITHUB_PROJECTS_TOKEN=ghp_... LIVE_GITHUB_PROJECT_NUMBER=1 npm run test:live
```

The workflow [`.github/workflows/live-github-tests.yml`](.github/workflows/live-github-tests.yml) runs the same suite on GitHub Actions, started by hand from the Actions tab only (SC-127). It takes its settings from the `live` environment that Terraform writes. Give the environment required reviewers if the tokens should be used only on a person's approval.

### REST API

The REST API (SC-026) is served under `/api`, in `backend/src/api/`. Each part of the service layer gets a route group, added to `routeGroups` in `backend/src/api/api.ts`, and each module of the service layer is added to `Services` in `backend/src/service/services.ts`, which every route group is registered with as `services`. A route only translates the request and calls the service layer, passing it `callerOf(request)`; the rules, permission checks included, live in the service layer (DD-039), which refuses a request by throwing a `ServiceError` (`backend/src/service/errors.ts`). The API:

- refuses with 401, before the route runs, a request that no configured authenticator recognises (there is none yet, so every request is refused until the sign-in and token SCs add theirs); an unknown route under `/api` answers 401 too, and 404 only to an authenticated caller;
- refuses to start if a route lacks a success response schema that says what it sends (a `type`, and for an object its `properties` or a schema for its values), a body schema (POST, PUT, PATCH) or a params schema (a URL with parameters), so nothing goes out undescribed; a querystring schema is the route author's duty, as the guard cannot tell whether a route reads one;
- answers every error as `{ statusCode, error, message }`: a `ServiceError` as 400, 403, 404 or 409 with its message, a request Fastify itself refuses (schema, JSON, content type) with Fastify's status and message, and any other error, even one carrying a status of its own, as 500 with no detail, logged on the server.
- serves its OpenAPI description (SC-063) at `/api/openapi.json`, behind the same authentication. `@fastify/swagger` generates it from the routes' schemas as they are registered, so it always matches the running backend. So that it covers every route, the API refuses to start if a route would drop out of it or be described wrongly: a route with `hide: true` or the `X-HIDDEN` tag (only the description's own route is hidden), a route with a version constraint, a HEAD route declared by hand (the HEAD route Fastify adds for each GET is fine), or a shared schema `$id` added in two route groups with different content.

The MCP server (SC-027) is served at `/mcp`, in `backend/src/mcp/mcp.ts`, over the MCP Streamable HTTP transport without sessions (DD-049). Point an MCP client at `<the tool's address>/mcp` with a personal access token, created on the API tokens page, as `Authorization: Bearer <token>` (DD-048); a request without a working token is refused with 401. Its tools are `list_projects`, `read_plan`, `read_notifications` and `create_proposal`: they read the plan and the caller's notifications, and create proposals, through the same service layer as the REST API, as the token's owner, through the MCP channel. It offers no other change to the plan (FR-068). Each answer has the REST API's shape for the same thing; a refusal is a tool error whose text is the REST API's error body.

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
- [`.github/workflows/windows-package.yml`](.github/workflows/windows-package.yml), which CI runs on every pull request, builds the Windows zip on a Windows machine with `node scripts/package-windows.ts`, unpacks it into a folder whose path has a space in it, and runs `npm run test:windows` against the PostgreSQL the runner has installed (SC-123). The zip's Node.js runtime is the one `actions/setup-node` installed; WinSW is downloaded at a pinned version and checked against its checksum.
- **Windows releases.** [`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml) publishes the zip as a GitHub Release for each version tag pushed (`git tag v0.1.0 && git push origin v0.1.0`), as `cold-seance-<tag>-windows-x64.zip` (SC-124, DD-061). It signs the zip's contents through [SignPath](https://signpath.org/), free for open-source projects, once the repository has the variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG` and the secret `SIGNPATH_API_TOKEN`. Until then it publishes the zip unsigned and says so in the release. The SignPath project's artifact configuration names what is signed: the artifact is a zip holding `cold-seance-windows-x64.zip`, in which the project's own `backup.ps1` is the file to sign.
- [`.github/workflows/live-github-tests.yml`](.github/workflows/live-github-tests.yml) runs the live GitHub tests against the test deployment, only when started by hand (SC-127); see [Live GitHub tests](#live-github-tests).
- [Dependabot](.github/dependabot.yml) proposes npm, GitHub Actions and Docker base image updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
