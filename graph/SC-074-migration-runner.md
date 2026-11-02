---
certainty: assumed
effort: 3
---

# SC-074: Migration runner

The backend's own TypeScript code that, on start and before serving requests, applies the pending migrations in order, each in its own transaction, under an advisory lock, records them, stops on a failed migration, and refuses to start on a database with a migration it does not know ([DD-052](DD-052-schema-changes-are-numbered-sql-migrations-applied.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)).

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
