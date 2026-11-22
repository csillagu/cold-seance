# DD-061: The tool also ships for Windows as a portable zip, with PostgreSQL and backups left to the user

## Decision

Besides the application image and its Docker Compose installation ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)), which stay, the tool is published for Windows as a portable zip. The zip holds Node.js's own Windows runtime, the built backend and frontend, the backend's run-time dependencies, its migrations and a start script. Unpacked into any folder, it runs natively on Windows, with no Docker, WSL or other virtualization ([SRC-260](SRC-260-the-tool-can-be-installed-to-run-natively-on-windo.md)). Everything in it is open source and free ([SRC-261](SRC-261-the-whole-tool-runs-from-open-source-materials-wit.md)).

- **Starting:** the user starts the tool by hand with the start script, or, if they choose, registers it as a Windows service that starts at boot. The service wrapper is WinSW, which is MIT-licensed and shipped in the zip. When the service is stopped, the wrapper sends the backend Ctrl+C. The backend takes Ctrl+C as an interrupt and closes cleanly, as it does when Docker stops the image.
- **Database:** the user installs PostgreSQL, or uses a hosted one ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)), and gives its address in the configuration ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)). The zip holds no database.
- **Listening:** the zip keeps the backend's default address, this machine only (`127.0.0.1`), on port 3000 ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)).
- **Publishing:** the zip is published as a GitHub Release each time a version tag is pushed. The application image is published for the same version tags, from the same commit ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)).
- **Signing:** the zip's contents are signed through a free code-signing service for open-source projects, such as SignPath.io, once the service has accepted the project.
- **Backups** are the user's ([SRC-262](SRC-262-backups-are-left-to-the-user-helped-by-documentati.md)). The Windows installation's documentation shows how to back up with `pg_dump` and restore with `pg_restore`, and how to use pgAdmin's Backup and Restore dialogs instead. The zip holds a backup script. It dumps the database into a dated file in a folder the user names, and deletes that folder's dumps older than 7 days. It takes the database password from PostgreSQL's own password file, so no secret is written in the script. One scheduled-task command, given in the documentation, runs it every night at 02:00. The documentation says plainly that the configuration file and the GitHub App key files are not in the dump and must be backed up separately. The Docker Compose installation keeps its documented `pg_dump` and gets no scheduled backup.

## Alternatives considered

- For the package: a single executable with the frontend and the migrations embedded in it, an installer (Inno Setup or a WiX MSI), or a combination of these with the zip.
- For starting: always registering a service, or never offering one. For the service wrapper: NSSM instead of WinSW.
- For the database: bundling PostgreSQL's binaries in the package, or moving to SQLite.
- For listening: every interface (`0.0.0.0`), as the image does.
- For signing: shipping unsigned, or shipping unsigned now and signing later.
- For publishing: a GitHub Release on each push to the main branch, tagged like the image, or the zip only as an artifact of a CI run.
- For the backup script: keeping dumps for 14 or 30 days.
- For backups: a backup feature in the tool itself, with scheduled dumps run by the backend's timer, a backup status in the frontend, a restore button and notifications of failed backups. For the Docker Compose installation: an optional backup service, such as the `postgres-backup-local` image.

## Rationale

The backend is plain Node.js, and none of its dependencies needs a compiled native module. The same built files that the image runs therefore run on Windows with Node.js's own runtime beside them. A zip is the cheapest package: it needs no installer to build and none to run, and it is laid out like the image, so the backend finds its frontend and its migrations where it always does. An installer or a single executable would add a build to maintain, and a single executable would change how the backend finds its files.

A service is optional because not every installation needs the tool to start at boot. The backend stops cleanly on an interrupt, but Windows never sends the stop signal Docker sends. A wrapper that stops the service with Ctrl+C lets the backend close cleanly with no code for Windows alone. WinSW is maintained and is set up by one file that ships in the zip. NSSM has had no release since 2017.

PostgreSQL stays the user's for the reasons DD-040 gave against putting it in the application's container. Bundled, its upgrades would be tied to the tool's releases, and its backups and data folder would be the project's to manage. SQLite would go against [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md). PostgreSQL's Windows installer is free, and it brings `pg_dump`, `pg_restore` and pgAdmin, which are what the backup instructions and the script use.

Listening on this machine only is the backend's own default: a zip run on a desktop computer is not opened to its network until someone sets it to be. Version tags let a Windows user download, keep and go back to a known build. Signing removes the warning Windows shows for a file from an unknown publisher, and a service for open-source projects costs nothing ([SRC-261](SRC-261-the-whole-tool-runs-from-open-source-materials-wit.md)).

Leaving backups to the user keeps the tool out of work that PostgreSQL's own tools already do well ([SRC-262](SRC-262-backups-are-left-to-the-user-helped-by-documentati.md)). The supplied script makes a nightly backup one command to set up, and seven days of dumps cover a week without filling the disk.

## Trade-offs

- The zip is unpacked and configured by hand: no installer asks for the database address or registers the service.
- The zip carries Node.js's runtime (about 30 MB more), and has to be published again when Node.js has a fix.
- A third-party wrapper, WinSW, ships in the zip and must be kept up to date.
- The user installs and looks after PostgreSQL, its upgrades included.
- Two packages to publish for each release: the image and the zip.
- Until the signing service accepts the project, the zip ships unsigned.
- The tool knows nothing of its backups: it cannot show whether the last one worked.

## Risks

- The tool has not been run on Windows before this decision; only a CI run on Windows shows that it works.
- Users may skip backups, since nothing in the tool asks for them.
- A scheduled backup that fails goes unnoticed: the tool does not know of it. Only the scheduled task's last result shows it.
- A backup that was never restored may not restore. The documentation must recommend testing a restore once.
- The configuration file, the key files and the PostgreSQL password file are not in the dump; a user who backs up only the dump cannot bring the tool back with the same settings.
- Until the zip is signed, Windows warns about its files, and PowerShell may refuse to run the backup script unless its execution policy allows it.
- The service runs as WinSW's default account, LocalSystem, which can do anything on the machine. A flaw in the tool reached through the network would have that reach.
- A configuration file or key file readable by other users of the machine gives away its secrets. Windows has no `node` user to restrict them to, so the documentation must say how to restrict them on Windows.
- Signing depends on a third-party service's acceptance and terms, which the project does not control.

## Serves

This decision serves [SRC-260](SRC-260-the-tool-can-be-installed-to-run-natively-on-windo.md), [SRC-261](SRC-261-the-whole-tool-runs-from-open-source-materials-wit.md), [SRC-262](SRC-262-backups-are-left-to-the-user-helped-by-documentati.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md).

Origin: issue #235 records the owner's request (SRC-260, SRC-261, SRC-262) and the design discussion of 2026-11-16. It left nine questions to the owner, who answered them in the design session of 2026-11-17, choosing among the options Claude offered. For the package: "Portable zip", over a single executable and an installer. For starting: "Optional service", over always registering a service and starting by hand only. For the listen address: "127.0.0.1". For signing: "Free OSS signing", over shipping unsigned and signing later. For publishing: "Version-tagged Releases", over a release on each push to main and a CI artifact only. For the backup script: "Nightly, 7 days", over 14 and 30 days, with the folder a parameter and the run at 02:00, as the option said. For the Docker Compose installation's backups: "No, docs only". For recording it: "New DD", over amending DD-040. Bundling PostgreSQL, SQLite and a backup feature in the tool were set aside in the discussion of 2026-11-16. WinSW over NSSM, the service's account and the wording, rationale, trade-offs and risks are Claude's, and await the owner's confirmation. That the image has no version tags was changed for issue #249, when the owner asked in the design session of 2026-11-22 for the image's releases to match the zip's ([SRC-275](SRC-275-docker-images-are-published-for-each-release-match.md)).
