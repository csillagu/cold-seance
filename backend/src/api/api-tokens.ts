import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const token = {
  type: 'object',
  required: ['id', 'createdAt', 'expiresAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'When the token stops working; null when it never does.',
    },
  },
} as const

/**
 * The routes of personal access tokens (SC-016, SC-026): list the caller's own tokens, create one,
 * and revoke one. They only translate the request; the token service decides what is allowed
 * (DD-039).
 */
export const apiTokenRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: token } } } },
    async (request) => services.apiTokens.listTokens(callerOf(request)),
  )

  group.post<{ Body: { expiresAt?: string } }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            expiresAt: {
              type: 'string',
              format: 'date-time',
              description: 'When the token stops working; it never does when not given.',
            },
          },
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            required: ['token', 'secret'],
            properties: {
              token,
              secret: {
                type: 'string',
                description: 'The token itself, shown this once: it cannot be read again.',
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { expiresAt } = request.body
      const created = await services.apiTokens.createToken(
        callerOf(request),
        expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt) },
      )
      return reply.code(201).send(created)
    },
  )

  group.delete<{ Params: { tokenId: string } }>(
    '/:tokenId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: { tokenId: { type: 'string', format: 'uuid' } },
        },
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.apiTokens.revokeToken(callerOf(request), request.params.tokenId)
      return reply.code(204).send()
    },
  )
}
