# Installing with Docker Compose

The Compose install runs two containers: the application image `ghcr.io/csillagu/cold-seance` and the official PostgreSQL 18 image, which keeps the tool's data in a Docker volume. Images are published for `linux/amd64` and `linux/arm64`.

- [Requirements](#requirements)
- [Install](#install)
- [Options](#options): time zone, secrets as environment variables, an existing PostgreSQL
- [Backing up and restoring](#backing-up-and-restoring)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [What to look out for](#what-to-look-out-for)

## Requirements

- **A container runtime with Compose.** Any of these works:
  - Docker Engine with the Compose plugin, on Linux. It is open source and free.
  - [Podman](https://podman.io/) with `podman compose`, or [Podman Desktop](https://podman-desktop.io/) or [Rancher Desktop](https://rancherdesktop.io/), on Linux, Windows and macOS. All are free.
  - Docker Desktop. Its licence requires a paid subscription for organisations with more than 250 employees or more than $10 million in annual revenue.
- **GitHub access:** a GitHub App, or personal access tokens. Set it up first, as [GitHub setup](github-setup.md) describes.

## Install

1. **Create a folder** for the installation and fetch the Compose file and the example configuration into it:

   ```sh
   mkdir cold-seance && cd cold-seance
   curl -fsSLO https://raw.githubusercontent.com/csillagu/cold-seance/main/compose.yaml
   curl -fsSL https://raw.githubusercontent.com/csillagu/cold-seance/main/backend/config.example.yaml -o config.yaml
   mkdir secrets
   ```

2. **Put the GitHub App's private key** (the `.pem` file GitHub gave you) into `secrets/`, such as `secrets/github-app.pem`. The folder is mounted into the container at `/run/secrets`. If you use only personal access tokens, leave it empty, but it must exist.

3. **Edit `config.yaml`.** At least:

   ```yaml
   database:
     # The bundled database. Keep this address unless you use your own PostgreSQL.
     url: postgres://cold_seance:cold_seance@database:5432/cold_seance

   github:
     apps:
       readIssues: &app
         appId: 123456 # your App's id
         privateKeyFile: /run/secrets/github-app.pem # the path inside the container
         # webhookSecret: ... # only if the App sends webhooks
       writeIssues: *app
       projectsStatus: *app

   firstAdmin:
     username: admin
     password: choose-a-long-password
   ```

   [Configuration](configuration.md) explains every setting, and how to use tokens instead of an App. You can remove `firstAdmin` once you have signed in for the first time. It is only used while no system admin exists.

4. **Restrict the files.** `config.yaml` and the key files hold secrets. The container runs as the user `node`, uid 1000, which must be able to read them:

   ```sh
   sudo chown -R 1000:1000 config.yaml secrets
   sudo chmod 600 config.yaml secrets/*
   sudo chmod 700 secrets
   ```

5. **Start it:**

   ```sh
   docker compose up -d
   docker compose logs -f app   # Ctrl+C stops following the log, not the tool
   ```

   At start, the tool applies any pending database migrations, then logs that it is listening. If a setting is missing or wrong, it names each problem and exits. See [Troubleshooting](troubleshooting.md#the-tool-does-not-start).

6. **Sign in** at <http://localhost:3000> with the first admin's username and password, then go on with [Getting started](getting-started.md).

The tool is published on port 3000 of every network interface of the machine. Browsers sign in over plain HTTP only on the machine itself. To use it from other machines, put it behind HTTPS, as [Running it on a network](configuration.md#running-it-on-a-network) describes.

## Options

### Time zone

A task's actual start and finish are recorded as the date on which it was started or finished, in the tool's time zone. The image uses UTC unless you set `TZ`. Add an `environment` entry to the `app` service in `compose.yaml`:

```yaml
services:
  app:
    environment:
      TZ: Europe/Budapest
```

### Secrets as environment variables

Every setting can also be given as an environment variable, which wins over `config.yaml` (see [Configuration](configuration.md#where-settings-come-from)). To keep a token or password out of the file, put it in a `.env` file beside `compose.yaml`, readable only by you, and pass it on:

```yaml
services:
  app:
    environment:
      COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES: ${GITHUB_WRITE_TOKEN}
```

### An existing or hosted PostgreSQL

The bundled database is optional. To use your own PostgreSQL server instead, a hosted one included:

1. Create a database and a user that owns it.
2. Set `database.url` to its address, such as `postgres://cold_seance:password@db.example.com:5432/cold_seance`. If the address goes through a connection pooler, also set `database.directUrl` to a direct connection, which the migrations use.
3. Start only the application: `docker compose up -d --no-deps app`.

From inside the container, `localhost` is the container itself. To reach a PostgreSQL on the host machine, use the host's address, or `host.docker.internal`. On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `app` service for that.

## Backing up and restoring

**The volume is the data.** Everything the tool knows is in the PostgreSQL volume `cold-seance_database`. `docker compose down --volumes`, or removing the volume, deletes it for good. The tool does not back itself up: backups are your job.

**Back up** with `pg_dump`, which works while the tool runs:

```sh
docker compose exec -T database pg_dump -U cold_seance cold_seance > cold-seance-$(date +%F).sql
```

To take one every night at 02:00, add a line like this to your crontab (`crontab -e`), and copy the backups off the machine:

```cron
0 2 * * * cd /path/to/cold-seance && docker compose exec -T database pg_dump -U cold_seance cold_seance > backups/cold-seance-$(date +\%F).sql
```

A dump does not hold `config.yaml` or the key files in `secrets/`. Keep a copy of those somewhere safe as well, and update it after each change.

**Restore** a dump into an empty database:

```sh
docker compose down                        # stops both containers; the volume stays
docker volume rm cold-seance_database      # deletes the current data
docker compose up -d database              # a fresh, empty database
docker compose exec -T database psql -U cold_seance -d cold_seance < cold-seance-2026-11-22.sql
docker compose up -d
```

Test a restore once, on a scratch machine or in a separate folder, before you need it. A backup that has never been restored may not restore.

## Updating

Each release of the tool is published as an image, with the same version as the Windows zip of that release. The image's tags:

| Tag | What it is |
| --- | --- |
| `latest` | The latest release. `compose.yaml` runs this one. |
| A version, such as `v0.1.0` | That release. A release candidate, such as `v0.1.0-rc.1`, has a tag of its own but never becomes `latest`. |
| `main` | The latest build of the main branch, published from time to time between releases. Not a release: use it to try what is coming. |
| `sha-<full commit hash>` | The build of that commit. Every image carries one. |

The releases are listed on the repository's [Releases](https://github.com/csillagu/cold-seance/releases) page, with what each one changes.

1. **Take a backup** (see above). Migrations are not reversible: the only way back to an older version is to restore the backup taken before the update.
2. **Pull and restart:**

   ```sh
   docker compose pull
   docker compose up -d
   ```

   The tool applies the new migrations when it starts. If a migration fails, nothing of it is applied. The tool logs why and stays down until the problem is fixed.

`latest` moves when a release is published, so the steps above update to the latest release. To stay on a release, replace `latest` in `compose.yaml` with its version, such as `ghcr.io/csillagu/cold-seance:v0.1.0`. To move to a later release, change the version and follow the steps above. Going back to an earlier version needs the backup taken before the update, since migrations are not reversible.

**PostgreSQL updates.** `compose.yaml` pins the PostgreSQL image. To pick up a new minor release, fetch the latest `compose.yaml` again and run `docker compose up -d`. A new major version (18 to 19, say) cannot read the old volume. Back up, delete the volume, change the version and restore, as in [Restore](#backing-up-and-restoring).

## Uninstalling

```sh
docker compose down             # stops and removes the containers; the data stays
docker compose down --volumes   # also deletes the database volume and all data
```

## What to look out for

- **Back up the volume.** Removing it deletes all data, and Compose does nothing to protect it.
- **Sign-in needs HTTPS** from any machine other than the one the tool runs on. Over plain HTTP from elsewhere, the browser drops the sign-in cookie and you stay on the sign-in page.
- **The port is open on every interface.** Anyone who can reach port 3000 on the machine can reach the sign-in page. Behind a reverse proxy on the same host, publish it on localhost only: `ports: ['127.0.0.1:3000:3000']`.
- **`config.yaml` and `secrets/` must exist** before you start. If they are missing, the start fails, so that Docker does not mount empty folders in their place.
- **The bundled database password** (`cold_seance`) is a default. The database is not published outside the Compose network, so only the application reaches it. Changing `POSTGRES_PASSWORD` later has no effect on an existing volume.
- **The image is pulled from the GitHub Container Registry.** If `docker compose pull` answers `denied`, the image is not public for you. Sign in with `docker login ghcr.io` with a GitHub token that has the `read:packages` scope.
