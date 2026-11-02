---
certainty: assumed
effort: 8
---

# SC-026: REST API routes

The Fastify routes of the REST API ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)), each with a JSON schema for its request and response. Each route authenticates the caller, translates the request and calls the one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)); no rule lives in a route. There is a group of routes for each part of the service layer: tasks, task relations, task status, eligibility and assignment, person load, red flags, calendars and availability, baselines and variance, proposals, notifications and subscriptions, the audit log, projects and roles, groups, repositories, saved views, accounts, API tokens and the Gantt export. It is done when every read and change the UI offers has a route.

It delivers:

- [FR-087](FR-087-let-the-rest-api-and-the-mcp-server-read-notificat.md): Let the REST API and the MCP server read notifications
- [FR-114](FR-114-give-the-rest-api-full-read-and-write-access-with.md): Give the REST API full read and write access with the UI's permission checks
- [FR-115](FR-115-apply-the-same-rules-to-the-ui-the-rest-api-and-th.md): Apply the same rules to the UI, the REST API and the MCP server

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
