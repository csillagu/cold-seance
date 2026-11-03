---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-204: The database library is an existing one; Prisma was only an example

The tool's PostgreSQL schema and its migrations ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)) are managed with an existing library, not with code of the project's own. Prisma was named only as an example; which library is used is left to Claude to propose.

As received, in the design session of 2026-11-02, when Claude proposed a migration runner of the project's own: "what, use somethig built in, or some kind of library. Prism or similar." Claude reads "Prism" as Prisma.

As received, in the design session of 2026-11-03, asked whether Prisma is confirmed rather than Drizzle or another library: "Propose one. Prisma is just an example, whats the best."
