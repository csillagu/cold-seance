# DD-044: The backend uses the Fastify framework

## Decision

The backend is a Fastify application in TypeScript on Node.js. The REST API and the MCP server's endpoint are Fastify routes; each route only translates the request and calls the one service layer, where the rules live.

## Alternatives considered

Express, NestJS, or Fastify.

## Rationale

Fastify is written with TypeScript in mind and validates requests and responses against JSON schemas, from which the REST API's OpenAPI description can also be generated. It stays a thin HTTP layer, which suits keeping all rules in the service layer of [DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md). Express has no built-in validation or typing. NestJS brings its own module and dependency-injection structure, more machinery than one service layer needs.

## Trade-offs

Gives less ready-made structure than NestJS: keeping the service layer apart from the routes is the project's own discipline. Has a smaller ecosystem of middleware than Express.

## Serves

This decision serves [SRC-195](SRC-195-the-backend-is-written-in-typescript-on-node-js.md), [SRC-077](SRC-077-rest-api-with-full-read-and-write-access.md), [DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md).

Origin: proposed by Claude at the stakeholder's request in the design session of 2026-11-02 ("Ts something, propose (based on node)"). The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed".
