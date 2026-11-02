---
certainty: assumed
effort: 8
---

# SC-073: Database schema migrations

The numbered SQL migration files that create the tool's tables in PostgreSQL and change them from release to release ([DD-052](DD-052-schema-changes-are-numbered-sql-migrations-applied.md)), the plan being held in the tool's own backend ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)).

It is done when the migrations, applied in order to an empty database, create every table the service layer stores data in, and each later release adds its schema changes only as new migrations.

Origin: added by Claude for issue #11. Asked whether to add a component for the database schema and its migrations, the owner answered in the design session of 2026-11-02: "Yes, migration needs a plan." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
