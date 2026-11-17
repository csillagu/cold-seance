---
certainty: verified
---

# DD-040: The tool ships as one application image run with PostgreSQL by Docker Compose

## Decision

The tool is published as one Docker image holding the whole application: backend, frontend, MCP server and background jobs. It is installed with a Docker Compose file that runs that image next to the official PostgreSQL image, so installation is one command. The database address is configurable, so an existing PostgreSQL can be used instead of the bundled one.

The backend, the image's one process, also serves the built frontend to the browser: its files as they are, and its own page for any other address outside the REST API, since the frontend is a single-page application ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

The image is published on the GitHub Container Registry, built for both x86 (linux/amd64) and ARM (linux/arm64), and the Compose file runs it from there rather than building it. It is published from the main branch, tagged `latest` and by commit, with no version tags. The Compose file publishes the tool on port 3000 of every interface of the host, and gives the bundled PostgreSQL a default password; the database itself is not published, so only the application reaches it, over the Compose network.

The install instructions name free ways to run the Compose file besides Docker Desktop, whose licence asks larger organisations for a paid subscription: Docker Engine, Podman Desktop and Rancher Desktop ([SRC-261](SRC-261-the-whole-tool-runs-from-open-source-materials-wit.md)).

## Alternatives considered

One container holding both the application and PostgreSQL (the stakeholder's question), the application image alone with the user providing PostgreSQL, or installing from source.

For the frontend: the backend serving it, or the image only holding the built frontend, with how it reaches the browser left to a later component.

For the image: building it from the repository at installation, or publishing it to a registry; built for x86 only, or for ARM too. For its tags: version tags as well, or only `latest` and the commit. For the published port: this machine only, with a setting to widen it, or every interface. For the bundled database's password: one the installer must set, or a default.

## Rationale

One container holding both is possible, but it ties database upgrades to application releases, makes backups and data volumes unusual, and runs two services under one process supervisor, against how Docker images are normally built and run. A Compose file keeps installation to one command while PostgreSQL stays a standard container that is upgraded and backed up the usual way. Because the MCP server ([DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md)) and the hourly re-check ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md)) run in the backend process, there is only one application image. The backend serving the frontend keeps it that way: once built, the frontend is static files, and a web server of its own would be a second process or a second container to install.

A published image spares the installer a build and a copy of the repository, and the GitHub Container Registry sits beside the repository the image is built from. An ARM build lets the image run on ARM machines, such as Apple Silicon computers and ARM servers, as well as on x86 ones. Publishing on every interface lets other machines reach the tool with nothing more to set. A default password keeps installation to one command, and the bundled database is reachable only from the Compose network.

## Trade-offs

Two containers instead of one. Users need Docker Compose, not only Docker.

The backend also carries the frontend's file traffic, which a dedicated web server would serve more efficiently.

Without version tags, `latest` moves with every change to the main branch: an installation can stay on, or go back to, a given build only by its commit tag. Building for two platforms makes each publication take longer.

## Risks

- A user who removes the database volume, or never gives it one, loses all data. The install instructions must make the volume and its backup plain.
- Moving PostgreSQL to a new major version needs a dump and restore, which Compose does not do by itself.
- A new application version may need a database migration. If it fails on start, the tool does not come up until it is fixed.
- Hosts without Docker Compose need another way to run the image.
- A browser that still holds the page of an older version asks for files the new version no longer has, and the frontend fails to load until the page is reloaded.
- Published on every interface, the tool is open to the whole network the host is on, unless a firewall or a proxy limits it.
- The bundled database's default password is known to anyone who reads the Compose file: anyone who reaches the Compose network, or a database port someone publishes later, can use it.

## Serves

This decision serves [SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-261](SRC-261-the-whole-tool-runs-from-open-source-materials-wit.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md).

Origin: first added at the stakeholder's request in the design session of 2026-11-02, as a to-do: "lets add a dd thats basically a todo: decide exact deployment method (docker, docker compose? Etc)". Asked again on the same day whether to settle it, the stakeholder answered: "ompropose. I want people to install this simply. One docker container? Would that be a good idea?". The decision above is Claude's proposal in answer, with its alternatives, rationale and trade-offs. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and the stakeholder confirmed it in the same session: "1yes". The frontend's serving by the backend was added while the image was built (SC-028, issue #31): in the design session of 2026-11-03, asked how the built frontend reaches the browser, the owner chose "Backend serves it (Recommended)" over leaving it to a later component, and asked for it to be recorded in this DD: "Go with a". Its wording, rationale, trade-off and risk are Claude's; the owner confirmed them in the same session: "confirmed, update the origin notes". The image's registry, platforms and tags, the published port and the bundled database's default password were added while the Compose file was built (SC-029, issue #33). In the design session of 2026-11-03, asked whether the tool should be published on every interface rather than on its own machine only, the owner answered "1 yes"; asked about the bundled database's password, which Claude had left to the installer, the owner answered with a question, "3 add a default?", which Claude took as a yes; asked about the image, the owner answered "Publish images to github ghcr"; asked about version tags and ARM, "no version tags, add arm"; and asked whether to record these choices, "yes record them". The wording, alternatives, rationale, trade-offs and risks are Claude's and await the owner's confirmation. The free alternatives to Docker Desktop were added for issue #235: in the design session of 2026-11-17, asked whether the Docker instructions should name them, the owner answered "Yes, mention them". The wording is Claude's and awaits the owner's confirmation.
