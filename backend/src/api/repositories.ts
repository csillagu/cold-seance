import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const admin = {
  type: 'object',
  required: ['accountId', 'username'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
  },
} as const

const repository = {
  type: 'object',
  required: ['id', 'githubId', 'owner', 'name', 'admins'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    githubId: { type: 'integer' },
    owner: { type: 'string' },
    name: { type: 'string' },
    admins: { type: 'array', items: admin },
  },
} as const

const repositoryParams = {
  type: 'object',
  required: ['repositoryId'],
  properties: { repositoryId: { type: 'string', format: 'uuid' } },
} as const

const adminParams = {
  type: 'object',
  required: ['repositoryId', 'accountId'],
  properties: {
    repositoryId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
  },
} as const

interface AdminParams {
  repositoryId: string
  accountId: string
}

/**
 * The routes of the repository registry (SC-019, SC-026): list and read the registered
 * repositories with their admins, register one, and add or remove an admin. They only translate
 * the request; the repository service decides what is allowed (DD-039).
 */
export const repositoryRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: repository } } } },
    async (request) => services.repositories.listRepositories(callerOf(request)),
  )

  routes.post<{ Body: { owner: string; name: string } }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['owner', 'name'],
          properties: { owner: { type: 'string' }, name: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 201: repository },
      },
    },
    async (request, reply) => {
      const { owner, name } = request.body
      const created = await services.repositories.registerRepository(callerOf(request), {
        owner,
        name,
      })
      return reply.code(201).send(created)
    },
  )

  routes.get<{ Params: { repositoryId: string } }>(
    '/:repositoryId',
    { schema: { params: repositoryParams, response: { 200: repository } } },
    async (request) =>
      services.repositories.getRepository(callerOf(request), request.params.repositoryId),
  )

  routes.post<{
    Params: { repositoryId: string }
    Body: { accountId: string } | { username: string }
  }>(
    '/:repositoryId/admins',
    {
      schema: {
        description:
          'Makes a person an admin of the repository, named by exactly one of `accountId` and ' +
          '`username`. The username is matched regardless of case. Only its admins and system ' +
          'admins can; refused with 404 if there is no such account.',
        params: repositoryParams,
        body: {
          type: 'object',
          properties: {
            accountId: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
          },
          minProperties: 1,
          maxProperties: 1,
          additionalProperties: false,
        },
        response: { 200: repository },
      },
    },
    async (request) => {
      const { body } = request
      return 'username' in body
        ? services.repositories.addAdminByUsername(
            callerOf(request),
            request.params.repositoryId,
            body.username,
          )
        : services.repositories.addAdmin(
            callerOf(request),
            request.params.repositoryId,
            body.accountId,
          )
    },
  )

  routes.delete<{ Params: AdminParams }>(
    '/:repositoryId/admins/:accountId',
    { schema: { params: adminParams, response: { 204: { type: 'null' } } } },
    async (request, reply) => {
      const { repositoryId, accountId } = request.params
      await services.repositories.removeAdmin(callerOf(request), repositoryId, accountId)
      return reply.code(204).send()
    },
  )
}
