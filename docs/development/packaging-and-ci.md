# Packaging and CI

How the tool is packaged, tested in its packages, released and kept up to date. Installing the packages is in the user guide: [Docker Compose](../user-guide/install-docker.md) and [Windows](../user-guide/install-windows.md).

## Docker image

The [`Dockerfile`](../../Dockerfile) builds the one application image (SC-028, DD-040): the built frontend and the backend, which serves it, in one process. It holds no configuration and no key file; give them at run time. The image listens on port 3000 on every interface of the container (it sets `COLD_SEANCE_SERVER_HOST=0.0.0.0`), runs as the unprivileged `node` user, applies the pending migrations to its database at start (SC-074), and closes cleanly when Docker stops it.

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

## Compose file

[`compose.yaml`](../../compose.yaml) is the tool's installation (SC-029, DD-040): the published image next to the official PostgreSQL 18 image, whose major version is pinned (a move to a new one needs a dump and a restore, which Compose does not do). The image tests (`npm run test:image`, above) also run the Compose file from a scratch install directory, with the image under test in place of the published one: with its bundled database, and with an external one while the bundled one is stopped.

## Windows package

[`scripts/package-windows.ts`](../../scripts/package-windows.ts) builds the folder of the Windows portable zip (SC-120, DD-061) from the built backend and frontend, laid out as in the Docker image, with the Node.js runtime that runs the script, the WinSW service wrapper (SC-121) at a pinned version checked against its checksum, the backup script (SC-122) and the user guide. Its sources are in [`packaging/windows/`](../../packaging/windows/).

```sh
npm run build
node scripts/package-windows.ts --out <folder>            # on Windows
node scripts/package-windows.ts --out <folder> --node <a Windows node.exe>   # elsewhere
```

The script empties `<folder>` first. `npm run test:windows` tests an unpacked package (SC-120 to SC-122), on Windows only, against PostgreSQL, with the folder named by `TEST_WINDOWS_PACKAGE`.

## CI and dependencies

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs format, lint, typecheck and `db:check`, the unit tests, the integration tests and the browser tests (each with a PostgreSQL 18 service), the live GitHub tests, the build, the Docker image's build and tests, and the Windows package job, on every pull request to `main` and when started by hand. It does not run on pushes to `main` (#196). Started by hand on `main`, once every job but the live tests and the Windows package has passed, it publishes that build of `main` as the image `ghcr.io/csillagu/cold-seance`, tagged `main` and `sha-<commit>` (SC-130, DD-040), through [`publish-image.yml`](../../.github/workflows/publish-image.yml), which builds it for linux/amd64 and linux/arm64. The unit-test job adds a coverage table to the run's summary and keeps the HTML reports as the `coverage-report` artifact for 14 days. Coverage counts the unit tests only and has no minimum yet.
- [`.github/workflows/windows-package.yml`](../../.github/workflows/windows-package.yml), which CI runs on every pull request, builds the Windows zip on a Windows machine with `node scripts/package-windows.ts`, unpacks it into a folder whose path has a space in it, and runs `npm run test:windows` against the PostgreSQL the runner has installed (SC-123). The zip's Node.js runtime is the one `actions/setup-node` installed; WinSW is downloaded at a pinned version and checked against its checksum.
- **Releases.** Pushing a version tag (`git tag v0.1.0 && git push origin v0.1.0`) publishes the release twice over, from the tagged commit: the Docker image and the Windows zip. A final release is `v<major>.<minor>.<patch>`; a release candidate adds a suffix, such as `v0.1.0-rc.1`.
- **Image releases.** [`.github/workflows/release-image.yml`](../../.github/workflows/release-image.yml) builds and tests the image as CI does, then publishes it through `publish-image.yml`, tagged with the version as the Git tag writes it (`v0.1.0`) and `sha-<commit>` (SC-130, DD-040). A final release also moves `latest`, which `compose.yaml` runs, unless a final release of a higher version was tagged before it, so a fix tagged for an older version does not take `latest` back. A release candidate never moves it.
- **Windows releases.** [`.github/workflows/release-windows.yml`](../../.github/workflows/release-windows.yml) publishes the zip as a GitHub Release for each version tag pushed, as `cold-seance-<tag>-windows-x64.zip` (SC-124, DD-061). It signs the zip's contents through [SignPath](https://signpath.org/), free for open-source projects, once the repository has the variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG` and the secret `SIGNPATH_API_TOKEN`. Until then it publishes the zip unsigned and says so in the release. The SignPath project's artifact configuration names what is signed: the artifact is a zip holding `cold-seance-windows-x64.zip`, in which the project's own `backup.ps1` is the file to sign.
- [`.github/workflows/live-github-tests.yml`](../../.github/workflows/live-github-tests.yml) runs the live GitHub tests against the test deployment, only when started by hand (SC-127); see [Live GitHub tests](live-tests.md#live-github-tests).
- [Dependabot](../../.github/dependabot.yml) proposes npm, GitHub Actions and Docker base image updates weekly, once a release is a week old. Packages that must move together are grouped; other minor and patch updates come as one PR.
- npm runs no install scripts that `allowScripts` in `package.json` has not approved. esbuild's is denied, because esbuild works without it.
