import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const account = {
  type: 'object',
  required: ['id', 'username', 'systemAdmin'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
    systemAdmin: { type: 'boolean' },
  },
} as const

/**
 * The routes of account administration (SC-015, SC-026): list the accounts, create one, and make
 * someone a system admin; and of the GitHub account link (SC-054): read and set the GitHub account
 * a person's account is linked to. They only translate the request; the services decide who may
 * do what (DD-039).
 */
export const accountRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: account } } } },
    async (request) => services.accounts.listAccounts(callerOf(request)),
  )

  group.post<{ Body: { username: string; password: string } }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 201: account },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body
      const created = await services.accounts.createAccount(callerOf(request), {
        username,
        password,
      })
      return reply.code(201).send(created)
    },
  )

  group.post<{ Body: { accountId: string } }>(
    '/system-admins',
    {
      schema: {
        body: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 200: account },
      },
    },
    async (request) => services.accounts.makeSystemAdmin(callerOf(request), request.body.accountId),
  )

  const link = {
    type: 'object',
    required: ['accountId', 'githubLogin'],
    properties: {
      accountId: { type: 'string', format: 'uuid' },
      githubLogin: {
        type: ['string', 'null'],
        description: 'The name of the linked GitHub account; null until one is linked.',
      },
    },
  } as const
  const accountParams = {
    type: 'object',
    required: ['accountId'],
    properties: { accountId: { type: 'string', format: 'uuid' } },
  } as const

  group.get<{ Params: { accountId: string } }>(
    '/:accountId/github',
    { schema: { params: accountParams, response: { 200: link } } },
    async (request) => services.githubLinks.linkOf(callerOf(request), request.params.accountId),
  )

  group.put<{ Params: { accountId: string }; Body: { githubLogin: string } }>(
    '/:accountId/github',
    {
      schema: {
        params: accountParams,
        body: {
          type: 'object',
          required: ['githubLogin'],
          properties: { githubLogin: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 200: link },
      },
    },
    async (request) =>
      services.githubLinks.link(
        callerOf(request),
        request.params.accountId,
        request.body.githubLogin,
      ),
  )
}
