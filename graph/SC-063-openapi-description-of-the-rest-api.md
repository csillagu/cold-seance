---
certainty: assumed
effort: 1
---

# SC-063: OpenAPI description of the REST API

The OpenAPI description of the REST API, generated from the routes' JSON schemas ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)). The backend serves it as a route of its own beside the REST API, so it always matches the running version.

It is done when the description, as the running backend serves it, covers every REST API route with its request and response schemas.

Origin: split off from SC-026, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." Where it is published was added by Claude in the design session of 2026-11-03, at the owner's request to close the open point ("close these"). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
