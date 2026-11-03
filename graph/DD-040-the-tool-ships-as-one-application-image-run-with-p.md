---
certainty: verified
---

# DD-040: The tool ships as one application image run with PostgreSQL by Docker Compose

## Decision

The tool is published as one Docker image holding the whole application: backend, frontend, MCP server and background jobs. It is installed with a Docker Compose file that runs that image next to the official PostgreSQL image, so installation is one command. The database address is configurable, so an existing PostgreSQL can be used instead of the bundled one.

The backend, the image's one process, also serves the built frontend to the browser: its files as they are, and its own page for any other address outside the REST API, since the frontend is a single-page application ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

## Alternatives considered

One container holding both the application and PostgreSQL (the stakeholder's question), the application image alone with the user providing PostgreSQL, or installing from source.

For the frontend: the backend serving it, or the image only holding the built frontend, with how it reaches the browser left to a later component.

## Rationale

One container holding both is possible, but it ties database upgrades to application releases, makes backups and data volumes unusual, and runs two services under one process supervisor, against how Docker images are normally built and run. A Compose file keeps installation to one command while PostgreSQL stays a standard container that is upgraded and backed up the usual way. Because the MCP server ([DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md)) and the hourly re-check ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md)) run in the backend process, there is only one application image. The backend serving the frontend keeps it that way: once built, the frontend is static files, and a web server of its own would be a second process or a second container to install.

## Trade-offs

Two containers instead of one. Users need Docker Compose, not only Docker.

The backend also carries the frontend's file traffic, which a dedicated web server would serve more efficiently.

## Risks

- A user who removes the database volume, or never gives it one, loses all data. The install instructions must make the volume and its backup plain.
- Moving PostgreSQL to a new major version needs a dump and restore, which Compose does not do by itself.
- A new application version may need a database migration. If it fails on start, the tool does not come up until it is fixed.
- Hosts without Docker Compose need another way to run the image.
- A browser that still holds the page of an older version asks for files the new version no longer has, and the frontend fails to load until the page is reloaded.

## Serves

This decision serves [SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md).

Origin: first added at the stakeholder's request in the design session of 2026-11-02, as a to-do: "lets add a dd thats basically a todo: decide exact deployment method (docker, docker compose? Etc)". Asked again on the same day whether to settle it, the stakeholder answered: "ompropose. I want people to install this simply. One docker container? Would that be a good idea?". The decision above is Claude's proposal in answer, with its alternatives, rationale and trade-offs. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and the stakeholder confirmed it in the same session: "1yes". The frontend's serving by the backend was added while the image was built (SC-028, issue #31): in the design session of 2026-11-03, asked how the built frontend reaches the browser, the owner chose "Backend serves it (Recommended)" over leaving it to a later component, and asked for it to be recorded in this DD: "Go with a". Its wording, rationale, trade-off and risk are Claude's and await the owner's confirmation.
