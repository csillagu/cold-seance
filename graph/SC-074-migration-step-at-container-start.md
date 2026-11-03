---
certainty: assumed
effort: 1
---

# SC-074: Migration step at container start

The step in the backend's start that applies the pending migrations with Drizzle's migrator, over a direct database connection, before the backend starts serving requests ([DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)). It is done when starting a new version on an older database brings the schema up to date before the first request, and a failed migration keeps the backend from starting.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." It was first the project's own runner of DD-052, then ran Prisma's command (DD-055), both retired; it now runs Drizzle's migrator (DD-057). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: 1, lowered from the 3 estimated for the project's own runner; asked whether to lower it from 3 to 1, the owner answered in the design session of 2026-11-03: "Ok". That answer was given while the step ran Prisma's command; Drizzle's migrator is called the same way, from the backend's start.
