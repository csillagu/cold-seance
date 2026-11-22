# REST API

Everything you can do in the browser, you can do through the REST API, with the same permission checks and the same rules. The browser itself uses it. Use it for scripts, integrations and AI agents that do not speak MCP.

- [Tokens](#tokens)
- [The OpenAPI description](#the-openapi-description)
- [Conventions](#conventions)
- [Common calls](#common-calls)
- [Examples](#examples)

## Tokens

The API takes a personal access token in the `Authorization` header:

```http
Authorization: Bearer <token>
```

**Create one** under **Your account → API tokens**. You can give it an expiry date, or none. **The token is shown once,** when it is created: copy it then. The list shows only when each token was created and when it expires. **Revoke** a token there when it is no longer needed, or if it may have leaked.

A token acts as you, with your roles in each project, and its changes are recorded in the audit log under your name, through the REST API channel. Anyone who holds the token can do what you can, so keep it as secret as a password, and give each script or agent its own token so you can revoke one without the others.

## The OpenAPI description

The API describes itself as OpenAPI at `/api/openapi.json`. It is generated from the running server, so it always matches the version you have, and it lists every route with its parameters, request body and response:

```sh
curl -H "Authorization: Bearer $TOKEN" https://planning.example.com/api/openapi.json -o openapi.json
```

Load it into a tool such as [Swagger Editor](https://editor.swagger.io/) or Postman to browse it, or generate a client from it.

## Conventions

- **Base address:** `https://<the tool's address>/api`.
- **Bodies** are JSON, with `Content-Type: application/json`.
- **Ids** are UUIDs. Get them from list calls such as `GET /api/projects`.
- **Dates** are `YYYY-MM-DD`. Times, such as a token's expiry, are ISO 8601.
- **Errors** are always `{ "statusCode": ..., "error": ..., "message": ... }`, where `message` says why in plain words:

  | Status | Means |
  | --- | --- |
  | `400` | The request is not valid: a missing field, a date on a non-working day, a cycle of dependencies |
  | `401` | No valid token, or an expired or revoked one. An unknown address also answers `401` until you are signed in. |
  | `403` | Your role does not allow it, or the project is not visible to you |
  | `404` | No such thing |
  | `409` | It conflicts with the plan or its state, such as starting a task whose blocker is not done, or approving an expired proposal |
  | `500` | A fault on the server, logged there, with no detail in the answer |

## Common calls

| What | Call |
| --- | --- |
| Your projects | `GET /api/projects` |
| Search projects by name | `GET /api/projects/search?text=<text>` |
| A project's tasks | `GET /api/projects/{projectId}/tasks` |
| Create a task | `POST /api/projects/{projectId}/tasks` |
| Read, change a task | `GET`, `PATCH /api/tasks/{taskId}` |
| Set a task's status | `PUT /api/tasks/{taskId}/status` with `{ "status": "in-progress" }`, `"on-hold"` or `"done"` |
| Cancel a task | `POST /api/tasks/{taskId}/cancel` |
| Assign it to a repository, which creates its issue | `PUT /api/tasks/{taskId}/repository` with `{ "repositoryId": ... }` |
| A task's relations | `GET /api/tasks/{taskId}/relations` |
| Set its parent | `PUT /api/tasks/{taskId}/parent` with `{ "parentId": ... }`, or `null` |
| Add, remove a blocker | `POST /api/tasks/{taskId}/blocked-by` with `{ "blockerId": ... }`, `DELETE /api/tasks/{taskId}/blocked-by/{blockerId}` |
| A project's red flags | `GET /api/projects/{projectId}/red-flags` |
| The Gantt as Mermaid | `GET /api/projects/{projectId}/gantt/mermaid` |
| Your notifications | `GET /api/notifications` |
| Create a proposal | `POST /api/proposals`. See [AI proposals](mcp-and-proposals.md#the-proposal-format). |
| A project's proposals | `GET /api/projects/{projectId}/proposals` |

The OpenAPI description has the exact parameters and bodies of these and every other route: members, groups, repositories, calendars, baselines, saved views and more.

## Examples

List your projects:

```sh
curl -H "Authorization: Bearer $TOKEN" https://planning.example.com/api/projects
```

Create a five-day task starting on 1 December 2026:

```sh
curl -X POST https://planning.example.com/api/projects/$PROJECT/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Write the release notes", "plannedStart": "2026-12-01", "durationWorkingDays": 5 }'
```

Create a fixed-date milestone:

```sh
curl -X POST https://planning.example.com/api/projects/$PROJECT/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Release 1.0", "milestone": { "variant": "fixed-date", "date": "2026-12-18" } }'
```

Start a task:

```sh
curl -X PUT https://planning.example.com/api/tasks/$TASK/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "in-progress" }'
```

The task fields are the ones the browser's task editor shows: `title`, `description`, `plannedStart`, `plannedFinish`, `durationWorkingDays`, `effort`, `aiShare`, `personLoad` (for an AI-only task), `milestone` (only when creating), `eligibility`, `assignees` and `loadOverrides`. An eligibility expression is a person's account id, or `{ "all": [...] }` (AND) or `{ "any": [...] }` (OR) of account ids and of ANDs and ORs of account ids, at most two levels deep. [Planning](planning.md) explains what each field does.
