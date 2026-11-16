import fastJsonStringify from 'fast-json-stringify'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { errorBody, NOT_VISIBLE, STATUS, withoutQueryParams } from '../api/errors.ts'
import { notification } from '../api/notifications.ts'
import { project } from '../api/projects.ts'
import { proposal } from '../api/proposals.ts'
import { relations } from '../api/task-relations.ts'
import { task } from '../api/tasks.ts'
import type { Caller } from '../service/caller.ts'
import { ServiceError } from '../service/errors.ts'
import type { Services } from '../service/services.ts'
import { isUuid } from '../service/system-admins.ts'

/** Where the MCP server is served (DD-049): one endpoint of the backend, beside the REST API. */
export const MCP_PATH = '/mcp'

/** Who a token's secret belongs to: the token service (SC-016) answers it. */
interface TokenOwners {
  resolve(secret: string): Promise<string | undefined>
}

/** The service layer as the MCP server's tools call it (DD-039). */
export type McpServices = Pick<Services, 'notifications' | 'projects' | 'proposals' | 'tasks'> & {
  taskRelations: Pick<Services['taskRelations'], 'getRelations'>
  apiTokens: TokenOwners
}

/** How a request carries its API token: `Authorization: Bearer <token>`, as for the REST API. */
const BEARER = /^Bearer\s+(\S+)\s*$/i

const uuid = { type: 'string', format: 'uuid' } as const

/** A project's plan as the `read_plan` tool answers it. */
const plan = {
  type: 'object',
  required: ['tasks', 'relations'],
  properties: {
    tasks: { type: 'array', items: task },
    relations: { type: 'array', items: relations },
  },
} as const

/**
 * Each answer is written by the REST API's own schema for the same thing, so the MCP server and
 * the REST API answer a read alike (FR-067, DD-043).
 */
const write = {
  projects: serializer({ type: 'array', items: project }),
  plan: serializer(plan),
  notifications: serializer({ type: 'array', items: notification }),
  proposal: serializer(proposal),
}

/**
 * Writes a value as JSON by `schema`, as Fastify writes a response by its route's schema. The
 * schemas are declared `as const` for the routes; the copy given to the compiler is a plain one.
 */
function serializer(schema: object): (value: unknown) => string {
  const compiled: (value: unknown) => string = fastJsonStringify(JSON.parse(JSON.stringify(schema)))
  return compiled
}

/** What each tool is given, read from its arguments. */
interface ToolArguments {
  projectId?: unknown
  groups?: unknown
}

interface ToolDefinition {
  tool: Tool
  call(caller: Caller, args: ToolArguments): Promise<string>
}

/**
 * The MCP server's tools (SC-027). They read the plan and the caller's notifications, and create
 * proposals; no tool changes the plan in any other way, nor approves, edits or rejects a proposal
 * (FR-068). Each calls the one service layer as the caller, through the MCP channel, so the same
 * roles and rules apply as through the UI and the REST API (FR-113, FR-115).
 */
function tools(services: McpServices): readonly ToolDefinition[] {
  return [
    {
      tool: {
        name: 'list_projects',
        description: 'Lists the projects you can read, by id and name.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
      },
      call: async (caller) => write.projects(await services.projects.listProjects(caller)),
    },
    {
      tool: {
        name: 'read_plan',
        description:
          "Reads a project's plan: its tasks, as the REST API's `GET /api/projects/{projectId}/" +
          "tasks` gives them, and each task's relations (parent, subtasks, blocked by), as " +
          '`GET /api/tasks/{taskId}/relations` gives them, in the same order as the tasks.',
        inputSchema: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { ...uuid, description: 'The project, by id' } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
      call: async (caller, args) => {
        const tasks = await services.tasks.listTasks(caller, idArgument(args.projectId))
        const taskRelations = []
        for (const t of tasks) {
          taskRelations.push(await services.taskRelations.getRelations(caller, t.id))
        }
        return write.plan({ tasks, relations: taskRelations })
      },
    },
    {
      tool: {
        name: 'read_notifications',
        description:
          "Reads your in-app notifications, newest first, as the REST API's `GET " +
          '/api/notifications` gives them. Reading them leaves them in place.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
      },
      call: async (caller) =>
        write.notifications(await services.notifications.notificationsOf(caller)),
    },
    {
      tool: {
        name: 'create_proposal',
        description:
          'Creates a proposal: groups of changes to the plan, each group kept, edited or dropped ' +
          'as one, for people to review. It changes nothing in the plan until each project it ' +
          'changes has approved it, which is done in the tool, not here. A change is ' +
          '`{ "kind": ... }` with, by kind: `create-task`: `key`, `projectId`, `fields` (with a ' +
          '`title`); `update-task`: `task`, `fields`; `set-parent`: `task`, `parent` (or null); ' +
          '`add-blocker` and `remove-blocker`: `task`, `blocker`; `set-status`: `task`, ' +
          '`status` (`in-progress`, `on-hold` or `done`); `cancel-task`: `task`; ' +
          '`assign-repository`: `task`, `repositoryId`. A task is named `{ "taskId": <id> }`, ' +
          'or `{ "newTask": <key> }` for one a create-task change of the same group creates. ' +
          "`fields` are those a task is created or changed with. Only a project's read-write " +
          'members and admins, of each project it changes, can create a proposal. Answers the ' +
          "proposal, as the REST API's `POST /api/proposals` does.",
        inputSchema: {
          type: 'object',
          required: ['groups'],
          properties: {
            groups: {
              type: 'array',
              description: 'The groups of changes: `[{ "changes": [<change>, ...] }, ...]`',
              items: { type: 'object' },
            },
          },
          additionalProperties: false,
        },
      },
      call: async (caller, args) =>
        write.proposal(await services.proposals.createProposal(caller, { groups: args.groups })),
    },
  ]
}

/** A tool's id argument, refused as the REST API refuses an id that is not one. */
function idArgument(value: unknown): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ServiceError('invalid', 'projectId must be an id')
  }
  return value
}

/**
 * A tool call's answer: what the tool wrote, or, marked as an error, the error body the REST API
 * would answer: for a refusal of the service layer, its status and message, so that the caller is
 * told why (FR-115); for anything else, a fault of the backend, which is logged, and of which the
 * caller learns only that it happened.
 */
async function answer(run: () => Promise<string>, log: FastifyBaseLogger): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await run() }] }
  } catch (error) {
    let body
    if (error instanceof ServiceError) {
      const statusCode = STATUS[error.kind]
      body = errorBody(
        statusCode,
        error.message,
        error.kind === 'not-visible' ? NOT_VISIBLE : undefined,
      )
    } else {
      log.error(
        { err: error instanceof Error ? withoutQueryParams(error) : error },
        'MCP tool call failed',
      )
      body = errorBody(500, 'Internal Server Error')
    }
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] }
  }
}

/** An MCP server for one request, acting as `caller`. */
function serverFor(
  caller: Caller,
  definitions: readonly ToolDefinition[],
  log: FastifyBaseLogger,
): Server {
  const server = new Server(
    { name: 'cold-seance', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        "Reads the tool's plan and your notifications, and creates proposals for people to " +
        'review. It makes no other change to the plan.',
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: definitions.map((definition) => definition.tool),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = definitions.find((d) => d.tool.name === request.params.name)
    if (!definition) {
      const body = errorBody(404, `No tool is named ${request.params.name}`)
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] }
    }
    const args: ToolArguments = request.params.arguments ?? {}
    return answer(() => definition.call(caller, args), log)
  })
  return server
}

/**
 * The MCP server (SC-027): served from the backend (DD-043) on one endpoint, `MCP_PATH`, over the
 * Streamable HTTP transport (DD-049), without sessions, so that any request may reach any
 * instance. Each request is authenticated by a personal access token (DD-048), sent as for the
 * REST API, and is made by the token's owner through the MCP channel; one without a working token
 * is refused with 401 before it reaches the MCP server.
 */
export function mcpServer(app: FastifyInstance, services: McpServices): void {
  const definitions = tools(services)

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    const secret = header === undefined ? undefined : BEARER.exec(header)?.[1]
    const accountId = secret === undefined ? undefined : await services.apiTokens.resolve(secret)
    if (accountId === undefined) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send(errorBody(401, 'Authentication required'))
    }
    const server = serverFor({ accountId, channel: 'mcp' }, definitions, request.log)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
    return reply
  }

  app.post(MCP_PATH, handle)
  app.get(MCP_PATH, handle)
  app.delete(MCP_PATH, handle)
}
