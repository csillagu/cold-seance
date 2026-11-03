---
certainty: assumed
effort: 8
---

# SC-073: Database schema migrations

The Drizzle schema of the tool's tables in PostgreSQL, written in TypeScript, and the migrations Drizzle's kit generates from it, which create the tables and change them from release to release ([DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md)), the plan being held in the tool's own backend ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)).

The schema and the migrations generated from it are one deliverable: a migration exists only as the change of the schema it is generated from. It is done when the migrations, applied in order to an empty PostgreSQL database, give a database against which the service layer's tests pass, and generating a migration from the schema yields no change, so the schema and the migrations agree.

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." It first rested on DD-052, then on DD-055 (Prisma), both retired; it rests on DD-057, Drizzle, which the owner chose in the design session of 2026-11-03: "Drizzle it is". After its quality review, the done criterion names a check against an empty database instead of a list of tables, and the item states that schema and migrations are one deliverable. The clause that each later release adds its schema changes only as new migrations was dropped from the done criterion with the owner's agreement in the design session of 2026-11-03 ("Ok"), so that the component has a clear finish. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
