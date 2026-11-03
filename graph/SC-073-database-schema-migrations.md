---
certainty: assumed
effort: 8
---

# SC-073: Database schema migrations

The Drizzle schema of the tool's tables in PostgreSQL, written in TypeScript, and the migrations Drizzle's kit generates from it, which create the tables and change them from release to release ([DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md)), the plan being held in the tool's own backend ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)).

It is done when the schema describes every table the service layer stores data in, and its migrations applied in order to an empty database create those tables.

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." It first rested on DD-052, then on DD-055 (Prisma), both retired; it rests on DD-057, Claude's proposal of Drizzle at the owner's request. The clause that each later release adds its schema changes only as new migrations was dropped from the done criterion with the owner's agreement in the design session of 2026-11-03 ("Ok"), so that the component has a clear finish. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
