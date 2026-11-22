---
certainty: assumed
effort: 1
---

# SC-029: Docker Compose file

The Docker Compose file that runs the application image next to the official PostgreSQL image, with a data volume for the database, so that installation is one command; the database address can be set to use an existing or hosted PostgreSQL instead ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)). It runs the image's `latest` tag, the latest release, so that pulling the images again updates an installation to the next release.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. That it runs `latest`, the latest release, is the owner's choice for issue #249 ([SRC-275](SRC-275-docker-images-are-published-for-each-release-match.md)). Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
