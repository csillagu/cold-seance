import type { FastifyPluginAsync } from 'fastify'
import { CHANNELS, PROPOSAL_CHANGE_KINDS } from '../db/schema.ts'
import type { ProposalInput } from '../service/proposals.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

/** A task a change names: an existing one by its id, or one the proposal creates by its key. */
const taskRef = {
  type: 'object',
  description:
    '`{ "taskId": <id> }` for an existing task, or `{ "newTask": <key> }` for a task a ' +
    'create-task change of the same group creates',
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    newTask: { type: 'string' },
  },
} as const

/** A change of a proposal as the routes send it back: the fields its kind has, and its id. */
const change = {
  type: 'object',
  required: ['id', 'kind', 'projectId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: [...PROPOSAL_CHANGE_KINDS] },
    projectId: {
      type: 'string',
      format: 'uuid',
      description: 'The project the change changes',
    },
    key: { type: 'string', description: 'A create-task change: the key of the new task' },
    task: { ...taskRef, description: 'The task the change changes; none for create-task' },
    fields: {
      type: 'object',
      additionalProperties: true,
      description: 'A create-task or update-task change: the fields it gives, as they were given',
    },
    parent: { ...taskRef, type: ['object', 'null'], description: 'A set-parent change' },
    blocker: { ...taskRef, description: 'An add-blocker or remove-blocker change' },
    status: { type: 'string', description: 'A set-status change' },
    repositoryId: { type: 'string', format: 'uuid', description: 'An assign-repository change' },
  },
} as const

/** A proposal as the routes send it (SC-010). */
export const proposal = {
  type: 'object',
  required: [
    'id',
    'createdBy',
    'channel',
    'createdAt',
    'lastEditedAt',
    'status',
    'rejectedAt',
    'rejectedBy',
    'projectIds',
    'groups',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    createdBy: { type: 'string', format: 'uuid', description: 'Who created it, by account id' },
    channel: {
      type: 'string',
      enum: [...CHANNELS],
      description: 'The channel it was created through: `rest-api` or `mcp`',
    },
    createdAt: { type: 'string', format: 'date-time' },
    lastEditedAt: {
      type: 'string',
      format: 'date-time',
      description: 'When it was created or last edited',
    },
    status: {
      type: 'string',
      enum: ['waiting', 'rejected', 'expired'],
      description:
        '`waiting` for review; `rejected`; or `expired`, when no one has edited it for more ' +
        'than 24 hours',
    },
    rejectedAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'When it was rejected; null if it was not',
    },
    rejectedBy: {
      type: ['string', 'null'],
      format: 'uuid',
      description: 'Who rejected it, by account id; null if no one did',
    },
    projectIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      description: 'The projects it changes',
    },
    groups: {
      type: 'array',
      description: 'Its groups of changes, each kept, edited or dropped as one, in order',
      items: {
        type: 'object',
        required: ['id', 'changes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          changes: { type: 'array', items: change },
        },
      },
    },
  },
} as const

export const proposalParams = {
  type: 'object',
  required: ['proposalId'],
  properties: { proposalId: { type: 'string', format: 'uuid' } },
} as const

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const

/**
 * The routes of the proposals (SC-010, SC-026): create one, and read it. They only translate the
 * request; the proposal store decides what is allowed (DD-039).
 */
export const proposalRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.post<{ Body: ProposalInput }>(
    '/',
    {
      schema: {
        description:
          'Creates a proposal: groups of changes to the plan, each group kept, edited or dropped ' +
          'as one. It changes nothing in the plan until it is approved. A change is `{ "kind": ' +
          '... }` with, by kind: `create-task`: `key`, `projectId`, `fields` (with a `title`); ' +
          '`update-task`: `task`, `fields`; `set-parent`: `task`, `parent` (or null); ' +
          '`add-blocker` and `remove-blocker`: `task`, `blocker`; `set-status`: `task`, ' +
          '`status` (`in-progress`, `on-hold` or `done`); `cancel-task`: `task`; ' +
          '`assign-repository`: `task`, `repositoryId`. A task is named `{ "taskId": <id> }`, ' +
          'or `{ "newTask": <key> }` for one a create-task change of the same group creates. ' +
          "`fields` are those a task is created or changed with. Only the project's read-write " +
          'members and admins, of each project it changes, can create a proposal, and only ' +
          'with an access token, not from the UI.',
        // No types inside, so that Fastify does not coerce a value: the proposal store alone
        // decides what a change is, the same for every channel (DD-039).
        body: {
          type: 'object',
          required: ['groups'],
          properties: {
            groups: {
              description: 'The groups of changes: `[{ "changes": [<change>, ...] }, ...]`',
            },
          },
          additionalProperties: false,
        },
        response: { 201: proposal },
      },
    },
    async (request, reply) => {
      const created = await services.proposals.createProposal(callerOf(request), request.body)
      return reply.code(201).send(created)
    },
  )

  group.get<{ Params: { proposalId: string } }>(
    '/:proposalId',
    { schema: { params: proposalParams, response: { 200: proposal } } },
    async (request) => services.proposals.getProposal(callerOf(request), request.params.proposalId),
  )
}

/**
 * The route of a project's proposals (SC-010, SC-026): list those that change the project. It
 * only translates the request; the proposal store decides what is shown (DD-039).
 */
export const projectProposalRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/proposals',
    {
      schema: {
        description:
          'The proposals that change the project, oldest first; one that changes other ' +
          'projects too only if the caller has a role in each of them.',
        params: projectParams,
        response: { 200: { type: 'array', items: proposal } },
      },
    },
    async (request) =>
      services.proposals.listProposals(callerOf(request), request.params.projectId),
  )
}
