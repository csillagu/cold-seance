---
certainty: assumed
effort: 8
---

# SC-073: Database schema migrations

The Prisma schema of the tool's tables in PostgreSQL, and the migrations Prisma Migrate generates from it, which create the tables and change them from release to release ([DD-055](DD-055-the-schema-and-its-migrations-are-managed-with-pri.md)), the plan being held in the tool's own backend ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)).

It is done when the schema describes every table the service layer stores data in, its migrations applied in order to an empty database create those tables, and each later release adds its schema changes only as new migrations.

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." It first rested on DD-052, now retired; it rests on DD-055, which uses Prisma at the owner's request. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
