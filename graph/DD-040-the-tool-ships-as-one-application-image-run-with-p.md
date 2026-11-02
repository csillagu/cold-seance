---
certainty: verified
---

# DD-040: The tool ships as one application image run with PostgreSQL by Docker Compose

## Decision

The tool is published as one Docker image holding the whole application: backend, frontend, MCP server and background jobs. It is installed with a Docker Compose file that runs that image next to the official PostgreSQL image, so installation is one command. The database address is configurable, so an existing PostgreSQL can be used instead of the bundled one.

## Alternatives considered

One container holding both the application and PostgreSQL (the stakeholder's question), the application image alone with the user providing PostgreSQL, or installing from source.

## Rationale

One container holding both is possible, but it ties database upgrades to application releases, makes backups and data volumes unusual, and runs two services under one process supervisor, against how Docker images are normally built and run. A Compose file keeps installation to one command while PostgreSQL stays a standard container that is upgraded and backed up the usual way. Because the MCP server ([DD-043](DD-043-the-mcp-server-is-part-of-the-backend.md)) and the hourly re-check ([DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md)) run in the backend process, there is only one application image.

## Trade-offs

Two containers instead of one. Users need Docker Compose, not only Docker.

## Risks

- A user who removes the database volume, or never gives it one, loses all data. The install instructions must make the volume and its backup plain.
- Moving PostgreSQL to a new major version needs a dump and restore, which Compose does not do by itself.
- A new application version may need a database migration. If it fails on start, the tool does not come up until it is fixed.
- Hosts without Docker Compose need another way to run the image.

## Serves

This decision serves [SRC-001](SRC-001-the-tool-is-self-hosted-and-open-source.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

Origin: first added at the stakeholder's request in the design session of 2026-11-02, as a to-do: "lets add a dd thats basically a todo: decide exact deployment method (docker, docker compose? Etc)". Asked again on the same day whether to settle it, the stakeholder answered: "ompropose. I want people to install this simply. One docker container? Would that be a good idea?". The decision above is Claude's proposal in answer, with its alternatives, rationale and trade-offs. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and the stakeholder confirmed it in the same session: "1yes".
