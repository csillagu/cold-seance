# Installing on Windows

cold-seance runs natively on Windows x64, with no Docker, WSL or other virtualization. The package is a folder holding a Node.js runtime, the tool, a start script, an optional Windows service and a backup script. Everything in it is open source and free. The tool stores its data in a PostgreSQL database that you install yourself.

There are two ways to get the package. They give the same folder, and every step after that is the same.

- [Option A: download the zip](#option-a-download-the-zip). This is quick, but the zip is not code-signed yet.
- [Option B: build the package yourself](#option-b-build-the-package-yourself), from the source code.

Then:

1. [Install PostgreSQL](#1-install-postgresql)
2. [Configure](#2-configure)
3. [Restrict the secret files](#3-restrict-the-secret-files)
4. [Start the tool](#4-start-the-tool)
5. Optionally, [run it as a Windows service](#run-it-as-a-windows-service)
6. [Set up backups](#backing-up)

Further down: [restoring](#restoring), [updating](#updating), [uninstalling](#uninstalling) and [what to look out for](#what-to-look-out-for).

## Option A: download the zip

Download `cold-seance-<version>-windows-x64.zip` of the latest release from the repository's [Releases](https://github.com/csillagu/cold-seance/releases) page. Each release publishes one.

### The zip is not signed yet

The project has applied for free code signing through [SignPath Foundation](https://signpath.org/). SignPath signs only for projects with "a certain verifiable reputation", which a new project may not have yet. Until it accepts the project, releases are published unsigned, and each release's notes say so.

Because the zip comes from the internet and has no signature from a known publisher, Windows marks it and everything unpacked from it as downloaded. Expect these warnings:

- **The browser** may say the file is not commonly downloaded. Choose to keep it.
- **SmartScreen** may show "Windows protected your PC" when you run `start.cmd` or the service wrapper. *More info*, then *Run anyway* lets it run.
- **PowerShell** may refuse to run `backup.ps1`, because it is an unsigned script from the internet.

**To avoid all three,** unblock the zip before you unpack it. Right-click the zip, choose **Properties**, tick **Unblock** at the bottom of the *General* tab, and click **OK**. The files unpacked from it then carry no internet mark. If you would rather not run a downloaded binary from a publisher Windows does not know, use option B: a folder you build yourself never carries the mark.

Even after releases are signed, SmartScreen builds trust in a new publisher from download history, so the warnings may still appear for a while.

### Unpack

Unpack the zip into a folder of its own, such as `C:\cold-seance`. Any folder works, `C:\Program Files\cold-seance` included. Then go on with [step 1](#1-install-postgresql).

## Option B: build the package yourself

You need, on a Windows x64 machine:

- **Node.js 26**, the Windows x64 installer from [nodejs.org](https://nodejs.org/). The package copies the `node.exe` that builds it, so this becomes the tool's runtime.
- **git**, from [git-scm.com](https://git-scm.com/download/win).
- **Internet access** during the build. npm downloads the dependencies, and the script downloads the [WinSW](https://github.com/winsw/winsw) service wrapper at a fixed version and checks its checksum.

In a command prompt:

```bat
git clone https://github.com/csillagu/cold-seance.git
cd cold-seance
npm ci
npm run build
node scripts/package-windows.ts --out C:\cold-seance
```

The folder named by `--out` is the package, unpacked, as option A's zip would give it. **The script deletes that folder before it writes the package**, so never point it at an existing installation that holds your `config.yaml`. To update, build into a new folder, as [Updating](#updating) describes.

## 1. Install PostgreSQL

Install PostgreSQL with the free Windows installer from [postgresql.org](https://www.postgresql.org/download/windows/), or use a PostgreSQL server you already have, a hosted one included. The installer also brings `pg_dump`, `pg_restore`, `psql` and pgAdmin, which the backups below use.

Create the tool's user and database, in pgAdmin's query tool or in `psql` as the `postgres` user:

```sql
CREATE ROLE cold_seance LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE cold_seance OWNER cold_seance;
```

## 2. Configure

Set up GitHub access first, as [GitHub setup](github-setup.md) describes. Then, in the tool's folder, copy `config.example.yaml` to `config.yaml` and fill it in. At least:

```yaml
database:
  url: postgres://cold_seance:choose-a-password@localhost:5432/cold_seance

github:
  apps:
    readIssues: &app
      appId: 123456
      privateKeyFile: 'C:\cold-seance\secrets\github-app.pem'
    writeIssues: *app
    projectsStatus: *app

firstAdmin:
  username: admin
  password: choose-a-long-password
```

Put the App's private key in a `secrets` folder inside the tool's folder, such as `C:\cold-seance\secrets\github-app.pem`.

**Write Windows paths in single quotes**, as above. In double quotes, a backslash starts an escape sequence and the path comes out wrong.

[Configuration](configuration.md) explains every setting. `firstAdmin` is only used while no system admin exists, and you can remove it after your first sign-in.

## 3. Restrict the secret files

`config.yaml` and the key files hold secrets. Restrict them to the accounts that run the tool. In a command prompt in the tool's folder, run as an administrator:

```bat
icacls config.yaml /inheritance:r /grant:r "SYSTEM:R" "Administrators:F" "%USERNAME%:R"
icacls secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)R" "Administrators:(OI)(CI)F" "%USERNAME%:(OI)(CI)R"
```

`SYSTEM` is the account the Windows service runs as. If you only run the tool as a service, leave out `"%USERNAME%:R"` and `"%USERNAME%:(OI)(CI)R"`.

## 4. Start the tool

Run `start.cmd` in the tool's folder. It applies any pending database migrations and serves the tool on <http://127.0.0.1:3000>. If a setting is missing or wrong, it names each problem and exits. See [Troubleshooting](troubleshooting.md#the-tool-does-not-start).

Open <http://localhost:3000>, sign in as the first admin, and go on with [Getting started](getting-started.md).

Ctrl+C stops the tool cleanly. The command prompt then asks whether to terminate the batch job, and either answer is fine.

- **Only this machine can reach it** unless you change `server.host`. To let other machines in, see [Running it on a network](configuration.md#running-it-on-a-network). Other machines must reach the tool over HTTPS, or the browser will not keep the sign-in.
- **Time zone:** a task's actual start and finish are recorded in Windows' time zone. The `TZ` environment variable overrides it, such as `set TZ=Europe/Budapest` before `start.cmd`.

## Run it as a Windows service

Running the tool as a Windows service, which starts at boot, is optional. The service wrapper is [WinSW](https://github.com/winsw/winsw), shipped as `cold-seance-service.exe` and set up by `cold-seance-service.xml`. In a command prompt in the tool's folder, run as an administrator:

```bat
cold-seance-service.exe install
cold-seance-service.exe start
```

`stop`, `restart`, `status` and `uninstall` work the same way, and so does the Services console (`services.msc`).

- The service runs the tool from its folder and reads `config.yaml` from there.
- It gets **no environment variables** except those set in `cold-seance-service.xml`, such as `<env name="TZ" value="Europe/Budapest" />`. Restart the service after changing the file.
- Its output goes to `cold-seance-service.out.log` and `cold-seance-service.err.log` in the folder.
- When the service stops, the tool closes cleanly. It is stopped by force only if it has not ended within 30 seconds.
- The service runs as `LocalSystem`, which can do anything on the machine. A flaw in the tool that someone reached through the network would have the same reach. Keep the tool reachable from this machine only unless you need otherwise, and then only through a reverse proxy.

## Backing up

The tool does not back itself up: backups are your job. A dump of the database holds all of the tool's data. It does **not** hold `config.yaml`, the GitHub App key files or the PostgreSQL password file below. Copy those somewhere safe yourself, and again after each change.

### Nightly backups with `backup.ps1`

1. **Create a password file.** `pg_dump` reads the database password from PostgreSQL's password file, so the password is never written in the script or the scheduled task. The task below runs as `SYSTEM`, so give it a file of its own. Create `C:\cold-seance\pgpass.conf` holding one line, with the host, port, database, user and password:

   ```text
   localhost:5432:cold_seance:cold_seance:choose-a-password
   ```

   Then restrict it:

   ```bat
   icacls C:\cold-seance\pgpass.conf /inheritance:r /grant:r "SYSTEM:R" "Administrators:F"
   ```

2. **Schedule it** for 02:00 every night. In a command prompt run as an administrator, enter this as one line. Put the backup folder on another disk, or copy it off the machine:

   ```bat
   schtasks /Create /TN "cold-seance backup" /SC DAILY /ST 02:00 /RU SYSTEM /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\cold-seance\backup.ps1 -Folder D:\backups\cold-seance -PassFile C:\cold-seance\pgpass.conf"
   ```

   Inside `/TR`, quote a path with spaces as `\"C:\Program Files\cold-seance\backup.ps1\"`.

3. **Run it once now** with `schtasks /Run /TN "cold-seance backup"`, and check that a dump appears in the folder.

Each run writes `cold_seance-<date>-<time>.dump` and deletes that database's dumps in the folder that are older than 7 days. These parameters change the defaults:

| Parameter | Default |
| --- | --- |
| `-KeepDays` | `7` |
| `-Database` | `cold_seance` |
| `-User` | `cold_seance` |
| `-Server` | `localhost` |
| `-Port` | `5432` |
| `-PgDump` | the `pg_dump` on `PATH`, or the newest one in `C:\Program Files\PostgreSQL` |
| `-PassFile` | the running user's `%APPDATA%\postgresql\pgpass.conf` |

`Get-Help .\backup.ps1 -Full` describes them all. To run the script by hand, start it as the scheduled task does: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backup.ps1 -Folder D:\backups\cold-seance`.

**Check on it.** The tool knows nothing of its backups, so a failing backup goes unnoticed unless you look. A failed run ends with a non-zero code. Task Scheduler shows that code as the task's *Last Run Result* (anything but `0x0`), and `schtasks /Query /TN "cold-seance backup" /V /FO LIST` prints it as its *Last Result* (anything but `0`). Check it, and the dumps folder, from time to time.

### By hand

From PostgreSQL's `bin` folder (`C:\Program Files\PostgreSQL\<version>\bin`):

```bat
pg_dump -Fc -h localhost -U cold_seance -f cold_seance.dump cold_seance
```

In pgAdmin, right-click the database, choose **Backup…** and the *Custom* format.

## Restoring

1. Stop the tool (Ctrl+C, or `cold-seance-service.exe stop`).
2. Create an empty database, as `postgres`: `CREATE DATABASE cold_seance_restored OWNER cold_seance;`
3. Restore the dump into it:

   ```bat
   pg_restore --no-owner -h localhost -U cold_seance -d cold_seance_restored D:\backups\cold-seance\cold_seance-<date>-<time>.dump
   ```

   A plain SQL dump, made without `-Fc`, is restored with `psql -h localhost -U cold_seance -d cold_seance_restored -f <file>` instead. In pgAdmin, right-click the new database and choose **Restore…**.

4. Either point `database.url` at `cold_seance_restored`, or, as `postgres`, swap the databases: `DROP DATABASE cold_seance;` then `ALTER DATABASE cold_seance_restored RENAME TO cold_seance;`.
5. Start the tool.

**Test a restore once:** restore a dump into a scratch database as above, start the tool on it, and check that your projects are there. A backup that has never been restored may not restore.

## Updating

1. **Stop the tool and take a backup.** Migrations are not reversible: the only way back to an older version is to restore the backup taken before the update.
2. **Get the new package:** download and unblock the new zip, or build it into a **new** folder with option B (`git pull`, `npm ci`, `npm run build`, `node scripts/package-windows.ts --out C:\cold-seance-new`).
3. **Replace the program files.** In the tool's folder, delete everything except `config.yaml`, the `secrets` folder, `pgpass.conf` and the `*.log` files. Then copy the new package's contents in their place.
4. **Start the tool**, which migrates the database. A service registered from the folder stays registered, so `cold-seance-service.exe start` is enough.

## Uninstalling

1. If it is a service: `cold-seance-service.exe stop`, then `cold-seance-service.exe uninstall`.
2. Remove the backup task: `schtasks /Delete /TN "cold-seance backup"`.
3. Delete the tool's folder.
4. To delete the data too, drop the database as `postgres`: `DROP DATABASE cold_seance; DROP ROLE cold_seance;`.

## What to look out for

- **Unblock the zip before unpacking it,** or expect SmartScreen and PowerShell warnings. You can also build the package yourself.
- **Single-quote Windows paths** in `config.yaml`.
- **The build script empties its `--out` folder** before writing to it.
- **Sign-in needs HTTPS** from any machine other than the one the tool runs on.
- **The service runs as `LocalSystem`** and gets no environment variables from your session. Set them in `cold-seance-service.xml`.
- **Back up, and check the backups.** A failed scheduled backup only shows in Task Scheduler.
- **Keep copies of `config.yaml`, the key files and `pgpass.conf`.** The database dump does not include them.
