---
certainty: assumed
effort: 3
---

# SC-074: Migration step at container start

The step in the application container's start that applies the pending migrations with Prisma's deployment command, over a direct database connection, before the backend starts serving requests ([DD-055](DD-055-the-schema-and-its-migrations-are-managed-with-pri.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)). It is done when starting a new version on an older database brings the schema up to date before the first request, and a failed migration keeps the backend from starting.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." It was first the project's own runner of DD-052, now retired; at the owner's request it now runs Prisma's command (DD-055), and its effort of 3 was estimated for the own runner. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
