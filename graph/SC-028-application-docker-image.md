---
certainty: assumed
effort: 2
---

# SC-028: Application Docker image

The Dockerfile, and the one image it builds, that packages the whole application ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)): the built frontend, and the backend with its MCP server and hourly re-check. The parts it packages are components of their own; this deliverable is the packaging. The image takes the address of its PostgreSQL database from its configuration.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11, and reworded after its quality review. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
