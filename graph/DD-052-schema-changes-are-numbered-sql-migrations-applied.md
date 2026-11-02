# DD-052: Schema changes are numbered SQL migrations applied when the backend starts

## Decision

The database schema is created and changed only by migrations: numbered SQL files kept in the repository and shipped inside the application image ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)). A migration is never edited once it is released, and migrations have no down steps.

When the backend starts, before it serves any request or runs the hourly re-check, it applies every migration not yet applied, in order, each in its own transaction, and records each one in a migrations table. A PostgreSQL advisory lock lets only one backend instance migrate at a time, as with the re-check's lock ([DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md)).

- If a migration fails, its transaction is rolled back, the database stays at the last migration that succeeded, and the backend stops with the error.
- If the database holds a migration the backend does not know, for example after an older version is started on a newer database, the backend refuses to start.

The runner is the project's own small TypeScript code in the backend.

## Alternatives considered

- Prisma Migrate or Drizzle Kit, which generate migrations from a schema model written in TypeScript.
- node-pg-migrate, a migration library for PostgreSQL.
- Running migrations as a separate command, or as a one-off service in the Compose file, instead of when the backend starts.
- Migrations with down steps that reverse them.

## Rationale

People who self-host the tool can read plain SQL files before they upgrade. Plain SQL also uses PostgreSQL's own features directly ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)). No DD settles which library the backend uses to query the database, and Prisma or Drizzle would settle that as a side effect of choosing how to migrate.

Applying migrations on start keeps an upgrade as simple as installation ([SRC-199](SRC-199-people-can-install-the-tool-simply.md)): pull the new image and restart. Migrations without down steps avoid reverse steps that are rarely tested. Going back to an older version means restoring the backup taken before the upgrade.

## Trade-offs

- No migration is generated from a schema model. Each one is written by hand, and the TypeScript types for the tables must be kept in step with the migrations.
- An upgrade cannot be rolled back quickly. One that goes wrong is undone by restoring a backup.
- A slow migration delays the start of the tool.

## Risks

- A migration that rewrites a large table, such as the audit log, keeps the tool down while it runs.
- Hosted services such as Neon ([SRC-200](SRC-200-the-tool-can-use-an-external-hosted-postgresql-suc.md)) offer pooled connections. A session advisory lock does not hold through a pooler in transaction mode, so the runner needs a direct, unpooled connection.
- A released migration that is edited afterwards leaves databases of different installations with different schemas.
- An upgrade made without a backup cannot be undone.
- This decision does not cover moving PostgreSQL itself to a new major version, which is one of DD-040's risks.

## Serves

This decision serves [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

Origin: proposed by Claude in the design session of 2026-11-02. Asked whether to add a component for the database schema and its migrations, the owner answered: "Yes, migration needs a plan." The decision, alternatives, rationale, trade-offs and risks are Claude's, and they await the owner's confirmation.
