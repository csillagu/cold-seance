# DD-055: The schema and its migrations are managed with Prisma

## Decision

The backend uses Prisma, an existing library, for its PostgreSQL schema and its migrations ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)), instead of code of the project's own. The schema is written in Prisma's schema file. Each change to it becomes a migration that Prisma Migrate generates as SQL and that is kept in the repository and shipped in the application image ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)).

When the application container starts, it applies the pending migrations with Prisma's deployment command before the backend serves any request. Prisma records each applied migration in the database, and takes a database lock so that two instances do not migrate at once. If a migration fails, Prisma marks it as failed and applies nothing more until the failure is resolved, so the tool does not come up until it is fixed (one of DD-040's risks). Migrations are not reversed: going back means restoring the backup taken before the upgrade.

Prisma's client is also the backend's way of querying the database, so the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) reads and writes through it.

## Alternatives considered

- The project's own small runner over plain SQL files (the retired DD-052, Claude's earlier proposal).
- Drizzle ORM with its migration kit, which takes its schema from TypeScript.
- Kysely, a typed query builder, with its built-in migrator.
- node-pg-migrate, a migration library for PostgreSQL alone.

## Rationale

The owner wants an existing library, not the project's own code: "use somethig built in, or some kind of library. Prism or similar." Prisma is the library they named. Its migration tool applies migrations in order, records them, locks against parallel runs and stops on a failed migration, which the retired DD-052 would have had to build. Its generated client gives TypeScript types that follow the schema, so the code cannot drift from the tables, the main trade-off of DD-052.

## Trade-offs

- Prisma also decides how the backend queries the database: the service layer uses Prisma's client, not plain SQL or another query builder.
- The schema is written in Prisma's own schema language, not in SQL or TypeScript.
- Queries Prisma's client cannot express, such as some PostgreSQL-specific ones, need raw SQL beside it.

## Risks

- Behind a connection pooler in transaction mode, as hosted services such as Neon offer ([SRC-200](SRC-200-the-tool-can-use-an-external-hosted-postgresql-suc.md)), migrations need a direct, unpooled connection. The configuration must offer one ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md)).
- A migration that rewrites a large table, such as the audit log, keeps the tool down while it runs.
- An upgrade made without a backup cannot be undone.
- Prisma's generated client must be built into the image, and a major new version of Prisma can change how it is configured or generated.

## Serves

This decision serves [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-200](SRC-200-the-tool-can-use-an-external-hosted-postgresql-suc.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

Origin: Claude proposed a migration plan of its own (DD-052) after the owner answered "Yes, migration needs a plan". In the design session of 2026-11-02 the owner rejected it: "what, use somethig built in, or some kind of library. Prism or similar." Claude reads "Prism" as Prisma. This DD takes Prisma, as named. The wording, alternatives, trade-offs and risks are Claude's, and they await the owner's confirmation.
