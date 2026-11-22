# Configuration

cold-seance reads its settings once, when it starts. Change a setting, then restart the tool.

- [Where settings come from](#where-settings-come-from)
- [All settings](#all-settings)
- [GitHub access](#github-access)
- [The first system admin](#the-first-system-admin)
- [Time zone](#time-zone)
- [Running it on a network](#running-it-on-a-network)
- [Checks at start](#checks-at-start)

## Where settings come from

**A YAML file.** The tool reads `config.yaml` in the folder it starts in, or the file named by the environment variable `COLD_SEANCE_CONFIG_FILE`. The Docker image reads `/app/config.yaml`. [`config.example.yaml`](../../backend/config.example.yaml) lists every setting with a comment. Copy it and fill it in.

**Environment variables.** Every setting can also be given as an environment variable named after its path, in capitals, with `COLD_SEANCE_` in front and an underscore between the words:

| Setting | Environment variable |
| --- | --- |
| `database.url` | `COLD_SEANCE_DATABASE_URL` |
| `github.apps.readIssues.appId` | `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID` |
| `github.tokens.writeIssues` | `COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES` |

- **The environment variable wins** over the file. An empty variable counts as not set.
- Without a file, the environment alone configures the tool.
- **A misspelt key stops the start.** A key in the file, or a `COLD_SEANCE_` variable, that is not a known setting is reported, so a typo cannot go unnoticed.

Environment variables are a good place for secrets, such as tokens and passwords, that you would rather not keep in a file.

## All settings

| Setting | Required | Default | What it is |
| --- | --- | --- | --- |
| `server.host` | no | `127.0.0.1` (the Docker image sets `0.0.0.0`) | The address the tool listens on. `127.0.0.1` lets in this machine only, and `0.0.0.0` every network interface. |
| `server.port` | no | `3000` | The port it listens on. |
| `database.url` | **yes** | | The PostgreSQL database, as `postgres://user:password@host:port/database`. |
| `database.directUrl` | no | `database.url` | A direct, unpooled connection to the same database, for the migrations at start. Set it when `database.url` goes through a connection pooler. |
| `github.apps.<function>.appId` | per function | | A GitHub App's id. See [GitHub access](#github-access). |
| `github.apps.<function>.privateKeyFile` | per function | | The path of that App's private key file (`.pem`). |
| `github.apps.<function>.webhookSecret` | no | | The secret of that App's webhook, if it sends webhooks. |
| `github.tokens.<function>` | per function | | A personal access token, given as its value. |
| `github.webhookSecret` | no | | The one secret shared by all webhooks set up directly on repositories or organizations. |
| `github.recheckIntervalMinutes` | no | `60` | How often the tool re-checks every linked issue against GitHub. |
| `github.statusField.name` | no | `Status` | The GitHub Projects field that starts and holds tasks. |
| `github.statusField.started` | no | `In Progress` | The option of that field that means started. |
| `github.statusField.onHold` | no | `On Hold` | The option that means on hold. |
| `firstAdmin.username` | no | | The first system admin's username. See [below](#the-first-system-admin). |
| `firstAdmin.password` | no | | Their password. |

The status field's option names are compared ignoring case.

## GitHub access

The tool calls GitHub for three functions:

| Function | What the tool does with it |
| --- | --- |
| `readIssues` | Reads issues, their sub-issues, blocked-by relations and assignees; seeds projects; runs the re-check |
| `writeIssues` | Creates issues, keeps their assignees, sub-issues, blocked-by relations and milestones in line with the plan, reopens or closes them, and comments on the reverts it makes |
| `projectsStatus` | Reads, and where it must undo a change, resets, the GitHub Projects status field that starts and holds tasks |

**Each function gets exactly one of the two:** a GitHub App under `github.apps.<function>`, or a personal access token under `github.tokens.<function>`. A function given both, or neither, stops the start. One App or one token can serve several functions, and Apps and tokens can be mixed across functions. YAML anchors make sharing short:

```yaml
github:
  apps:
    readIssues: &app
      appId: 123456
      privateKeyFile: /run/secrets/github-app.pem
    writeIssues: *app
  tokens:
    projectsStatus: ghp_xxxxxxxxxxxxxxxxxxxx # a classic token, for a Project owned by a user
```

A function given a token in an environment variable, such as `COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES`, must not also be given an App in the file. That counts as both.

[GitHub setup](github-setup.md) explains how to create the App or the tokens, which permissions each function needs, and how to set up webhooks.

## The first system admin

There is no self-registration: accounts are created by a system admin. To get the first one, set `firstAdmin.username` and `firstAdmin.password` (or `COLD_SEANCE_FIRST_ADMIN_USERNAME` and `COLD_SEANCE_FIRST_ADMIN_PASSWORD`), both or neither.

- When the tool starts and **no system admin exists yet**, it creates that account as a system admin. Sign in with it and create everyone else's account.
- **Once a system admin exists,** the two settings change nothing. You can remove them.
- The tool does not start if they name a username or password no account could have, or the username of an existing account that is not a system admin.

## Time zone

A task's actual start and finish are recorded as the date of the day it was started or finished, in the tool's local time zone. Set it with the standard `TZ` environment variable, such as `TZ=Europe/Budapest`. Without `TZ`, the Docker image uses UTC and Windows uses the machine's time zone.

## Running it on a network

**Browsers only sign in over HTTPS,** or on the machine the tool runs on (`http://localhost:3000`). The sign-in cookie is marked `Secure`, so a browser that reaches the tool over plain HTTP from another machine drops it, and you stay on the sign-in page.

So that other people can use the tool, put a reverse proxy with a TLS certificate in front of it:

1. Keep the tool on the local interface: `server.host: 127.0.0.1` (the default outside Docker), or, with Compose, `ports: ['127.0.0.1:3000:3000']`.
2. Run a reverse proxy on the same machine that serves HTTPS and forwards to `http://127.0.0.1:3000`.

With [Caddy](https://caddyserver.com/), which fetches a certificate by itself and also runs on Windows, the whole `Caddyfile` is:

```caddyfile
planning.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

With nginx:

```nginx
server {
    listen 443 ssl;
    server_name planning.example.com;
    ssl_certificate     /etc/ssl/planning.example.com.crt;
    ssl_certificate_key /etc/ssl/planning.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;   # lets MCP responses stream
    }
}
```

The tool serves everything from one address: the web interface, the REST API under `/api`, the MCP server at `/mcp` and the GitHub webhook endpoint at `/api/github/webhooks`.

**For webhooks,** GitHub must be able to reach `https://<your address>/api/github/webhooks` from the internet. A tool that only your internal network can reach cannot take webhooks, and works from the re-check alone. See [GitHub setup](github-setup.md#webhooks).

## Checks at start

The tool checks its whole configuration before it serves anything. It lists every problem and exits if:

- a required setting is missing, or a value is not valid;
- a key or `COLD_SEANCE_` variable is not a known setting;
- a GitHub App's key file cannot be read;
- a GitHub function is given both an App and a token, or neither;
- the first admin settings cannot be used.

It then applies any pending database migrations. If one fails, the tool logs why and exits, and the database is left as it was.
