# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues, pull requests or discussions.

Report them privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability** ([GitHub's guide](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)). Include what you can of:

- what the vulnerability is and what an attacker could do with it;
- the steps to reproduce it, or a proof of concept;
- the version affected: the release (such as `v0.1.0`) for the Windows zip, or the image tag (`sha-<commit>`) for Docker.

The report stays private between you and the maintainers until a fix is published. We then publish a GitHub security advisory and credit you, unless you prefer not to be named.

## Supported versions

Only the latest version is supported, and a fix is published as a new version:

- **Windows:** the latest release on the [Releases](https://github.com/csillagu/cold-seance/releases) page. Update as the [Windows installation guide](docs/user-guide/install-windows.md#updating) describes.
- **Docker:** the image `ghcr.io/csillagu/cold-seance:latest`. Update with `docker compose pull && docker compose up -d`.

## Deployment

cold-seance holds GitHub credentials (App keys or personal access tokens), the webhook secrets and its database password. The [configuration guide](docs/user-guide/configuration.md) describes how to configure the tool without building these into an image or committing them; keep `config.yaml` and the key files readable by the tool's user only.
