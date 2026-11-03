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
 * someone a system admin. They only translate the request; the account service decides who may do
 * what (DD-039).
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
}
