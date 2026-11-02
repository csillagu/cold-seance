# SC-028: Application Docker image

The one Docker image that holds the whole application: backend, frontend, MCP server and the hourly re-check. It takes the address of its PostgreSQL database from its configuration ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)).

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
