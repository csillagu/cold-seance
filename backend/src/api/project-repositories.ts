import type { FastifyPluginAsync } from 'fastify'
import { PROJECT_REPOSITORY_STATES } from '../service/project-repositories.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const person = {
  type: 'object',
  required: ['accountId', 'username'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
  },
} as const

const nullablePerson = { ...person, type: ['object', 'null'] } as const

const repository = {
  type: 'object',
  required: ['id', 'githubId', 'owner', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    githubId: { type: 'integer' },
    owner: { type: 'string' },
    name: { type: 'string' },
  },
} as const

const request = {
  type: 'object',
  required: [
    'id',
    'project',
    'repository',
    'state',
    'requestedBy',
    'requestedAt',
    'decidedBy',
    'decidedAt',
    'withdrawnBy',
    'withdrawnAt',
    'removedBy',
    'removedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
    },
    repository,
    state: {
      type: 'string',
      enum: [...PROJECT_REPOSITORY_STATES],
      description:
        "requested: waiting for one of the repository's admins; approved: the project pulls the repository's issues; rejected; withdrawn: an approval taken back; removed: the project's admin removed the repository from the project.",
    },
    requestedBy: person,
    requestedAt: { type: 'string', format: 'date-time' },
    decidedBy: {
      ...nullablePerson,
      description: 'Who approved or rejected it; the requester when they were admin of both.',
    },
    decidedAt: { type: ['string', 'null'], format: 'date-time' },
    withdrawnBy: { ...nullablePerson, description: 'Who withdrew the approval.' },
    withdrawnAt: { type: ['string', 'null'], format: 'date-time' },
    removedBy: {
      ...nullablePerson,
      description: "The project's admin who removed the repository from the project.",
    },
    removedAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const

const projectRepositoryParams = {
  type: 'object',
  required: ['projectId', 'repositoryId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    repositoryId: { type: 'string', format: 'uuid' },
  },
} as const

const requestParams = {
  type: 'object',
  required: ['requestId'],
  properties: { requestId: { type: 'string', format: 'uuid' } },
} as const

/**
 * The routes of a project's repositories (SC-110, SC-117, SC-026): read the repositories a project
 * pulls issues from and its requests for them, ask to add one, and remove one. They only translate the request; the
 * project repository service decides what is allowed (DD-039).
 */
export const projectRepositoryRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { projectId: string } }>(
    '/:projectId/repositories',
    {
      schema: { params: projectParams, response: { 200: { type: 'array', items: repository } } },
    },
    async (req) =>
      services.projectRepositories.listProjectRepositories(callerOf(req), req.params.projectId),
  )

  routes.delete<{ Params: { projectId: string; repositoryId: string } }>(
    '/:projectId/repositories/:repositoryId',
    {
      schema: {
        description:
          'Removes a repository from the repositories the project pulls issues from, and sends ' +
          'the approval it ended, now removed. The project keeps the tasks it has from the ' +
          'repository, linked to their GitHub issues but no longer synced with them; if it was ' +
          "the repository's receiving project, no project receives its new issues. Only the " +
          "project's admins can. Refused with 404 unless the project pulls from the repository.",
        params: projectRepositoryParams,
        response: { 200: request },
      },
    },
    async (req) =>
      services.projectRepositories.removeRepository(
        callerOf(req),
        req.params.projectId,
        req.params.repositoryId,
      ),
  )

  routes.get<{ Params: { projectId: string } }>(
    '/:projectId/repository-requests',
    { schema: { params: projectParams, response: { 200: { type: 'array', items: request } } } },
    async (req) =>
      services.projectRepositories.listProjectRequests(callerOf(req), req.params.projectId),
  )

  routes.post<{ Params: { projectId: string }; Body: { repositoryId: string } }>(
    '/:projectId/repository-requests',
    {
      schema: {
        description:
          'Asks to add a registered repository to the project, for the project to pull its ' +
          "issues and be seeded from it. The request waits for one of the repository's admins, " +
          "unless the caller is one, when it is approved at once. Only the project's admins can " +
          'ask. Refused with 404 for a repository not registered, and with 409 while the project ' +
          'has the repository or a request for it waiting.',
        params: projectParams,
        body: {
          type: 'object',
          required: ['repositoryId'],
          properties: { repositoryId: { type: 'string', format: 'uuid' } },
          additionalProperties: false,
        },
        response: { 201: request },
      },
    },
    async (req, reply) => {
      const created = await services.projectRepositories.requestRepository(
        callerOf(req),
        req.params.projectId,
        req.body.repositoryId,
      )
      return reply.code(201).send(created)
    },
  )
}

/**
 * The routes of the requests for the repositories the caller is an admin of (SC-110, SC-026):
 * list them, and approve, reject or withdraw one. They only translate the request; the project
 * repository service decides what is allowed (DD-039).
 */
export const repositoryRequestRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Querystring: { state?: string } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { state: { type: 'string', enum: [...PROJECT_REPOSITORY_STATES] } },
          additionalProperties: false,
        },
        response: { 200: { type: 'array', items: request } },
      },
    },
    async (req) => services.projectRepositories.listAdminRequests(callerOf(req), req.query.state),
  )

  const decisions = {
    approve: {
      method: 'approveRequest',
      description:
        "Approves a project's waiting request for the repository: the project then pulls its " +
        "issues. Only the repository's admins can; one is enough. Refused with 409 unless the " +
        'request is waiting.',
    },
    reject: {
      method: 'rejectRequest',
      description:
        "Rejects a project's waiting request for the repository, which stays out of the project " +
        "and can no longer be approved. Only the repository's admins can. Refused with 409 " +
        'unless the request is waiting.',
    },
    withdraw: {
      method: 'withdrawApproval',
      description:
        'Withdraws an approval given to a project: the project no longer pulls issues from the ' +
        "repository, and keeps the tasks it has from it. Only the repository's admins can. " +
        'Refused with 409 unless the approval is in force.',
    },
  } as const
  for (const [path, { method, description }] of Object.entries(decisions)) {
    routes.post<{ Params: { requestId: string } }>(
      `/:requestId/${path}`,
      {
        schema: {
          description,
          params: requestParams,
          // Nothing to send: the body may be left out, or be an empty object.
          body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
          response: { 200: request },
        },
      },
      async (req) => services.projectRepositories[method](callerOf(req), req.params.requestId),
    )
  }
}
