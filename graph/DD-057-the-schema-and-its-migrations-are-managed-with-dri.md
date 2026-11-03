---
certainty: verified
---

# DD-057: The schema and its migrations are managed with Drizzle

## Decision

The backend uses Drizzle ORM, an existing library ([SRC-204](SRC-204-the-schema-and-migrations-use-an-existing-library.md)), for its PostgreSQL schema, its migrations and its queries ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)). The schema is written in TypeScript, in the backend's own code. Each change to it becomes a migration that Drizzle's kit generates as an SQL file, which is kept in the repository and shipped in the application image ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)).

When the application container starts, the backend applies the pending migrations with Drizzle's migrator before it serves any request. Drizzle records each applied migration in the database and runs each migration inside a transaction, so a migration that fails leaves the database as it was; the tool does not come up until the failure is fixed (one of DD-040's risks). Migrations are not reversed: going back means restoring the backup taken before the upgrade.

Drizzle is also the backend's way of querying the database, so the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) reads and writes through it.

## Alternatives considered

- Prisma with Prisma Migrate, the library the owner named as an example (the retired DD-055).
- Kysely, a typed query builder, with its built-in migrator; its migrations are written by hand.
- node-pg-migrate, a migration library for PostgreSQL alone, with no query layer.
- The project's own small runner over plain SQL files (the retired DD-052), which the owner rejected.

## Rationale

The owner asked for the best existing library ([SRC-211](SRC-211-prisma-was-only-an-example-the-library-is-claude-s.md)). Drizzle is Claude's proposal over Prisma for this tool because:

- The schema is TypeScript, the language of the backend ([SRC-195](SRC-195-the-backend-is-written-in-typescript-on-node-js.md)), so there is no second schema language and no step that generates a client before the backend can be built or run.
- Its queries map closely to SQL, so PostgreSQL features such as JSON columns, which hold the eligibility tree ([DD-038](DD-038-eligibility-is-stored-as-a-tree.md)), are queried in the same layer instead of in raw SQL beside it.
- Each migration runs in a transaction, which PostgreSQL allows for schema changes, so a failed migration is undone by itself instead of being left marked as failed for someone to resolve by hand.
- The migrations are plain SQL files that can be read and reviewed in the repository.

Kysely and node-pg-migrate do not generate migrations from a schema, so each one would be written by hand. Prisma would serve too; it is the more established of the two, and its migrator also locks against parallel runs.

## Trade-offs

- Drizzle decides how the backend queries the database: the service layer uses Drizzle, not plain SQL or another query builder.
- Drizzle is younger than Prisma, with a smaller body of experience behind it.
- Generating a migration that renames a column or table needs the developer to answer whether it is a rename or a drop and add, which Drizzle's kit asks interactively.

## Risks

- Drizzle's migrator takes no lock against two instances migrating at once. DD-040 runs one application container, so this holds as long as one runs; running more needs a database lock around the migration step.
- Behind a connection pooler in transaction mode, as hosted services such as Neon offer ([SRC-200](SRC-200-the-tool-can-use-an-external-hosted-postgresql-suc.md)), migrations may need a direct, unpooled connection. The configuration must offer one ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md)).
- A migration that rewrites a large table, such as the audit log, keeps the tool down while it runs. A schema change that PostgreSQL cannot run inside a transaction, such as building an index concurrently, needs a migration of its own.
- An upgrade made without a backup cannot be undone.
- A major new version of Drizzle can change its schema or migration format.

## Serves

This decision serves [SRC-204](SRC-204-the-schema-and-migrations-use-an-existing-library.md), [SRC-211](SRC-211-prisma-was-only-an-example-the-library-is-claude-s.md), [SRC-195](SRC-195-the-backend-is-written-in-typescript-on-node-js.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [SRC-200](SRC-200-the-tool-can-use-an-external-hosted-postgresql-suc.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

Origin: Claude first proposed a migration runner of its own (DD-052), which the owner rejected for an existing library, naming Prisma (DD-055). In the design session of 2026-11-03 the owner said Prisma was only an example and asked Claude to propose the best library (SRC-211). This DD is that proposal. The owner chose it in the same session: "Drizzle it is". The wording, alternatives, rationale, trade-offs and risks are Claude's.
