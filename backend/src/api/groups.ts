import type { FastifyPluginAsync } from 'fastify'
import { PROJECT_ROLES } from '../service/project-roles.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const group = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
  },
} as const

const member = {
  type: 'object',
  required: ['accountId', 'username', 'role'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
    role: { type: 'string', enum: [...PROJECT_ROLES] },
  },
} as const

/**
 * The routes of groups (SC-018, SC-026): create a group, list every group, and list a group's
 * members with their roles. They only translate the request; the group service decides what is
 * allowed (DD-039).
 */
export const groupRoutes: FastifyPluginAsync<RouteGroupOptions> = async (routes, { services }) => {
  routes.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: group } } } },
    async (request) => services.groups.listGroups(callerOf(request)),
  )

  routes.post<{ Body: { name: string } }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 201: group },
      },
    },
    async (request, reply) => {
      const created = await services.groups.createGroup(callerOf(request), {
        name: request.body.name,
      })
      return reply.code(201).send(created)
    },
  )

  routes.get<{ Params: { groupId: string } }>(
    '/:groupId/members',
    {
      schema: {
        params: {
          type: 'object',
          required: ['groupId'],
          properties: { groupId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: member } },
      },
    },
    async (request) => services.groups.listMembers(callerOf(request), request.params.groupId),
  )
}
