import type { FastifyPluginAsync } from 'fastify'
import { PROJECT_ROLES, type ProjectRole } from '../service/project-roles.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const member = {
  type: 'object',
  required: ['accountId', 'username', 'role'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
    role: { type: 'string', enum: [...PROJECT_ROLES] },
  },
} as const

const memberParams = {
  type: 'object',
  required: ['projectId', 'accountId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
  },
} as const

interface MemberParams {
  projectId: string
  accountId: string
}

/**
 * The routes of a project's members (SC-014, SC-026): list the people who hold a role in a
 * project directly, give someone a role there, and take it away. They only translate the request;
 * the project role store decides who may do what (DD-039).
 */
export const projectMemberRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/members',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: member } },
      },
    },
    async (request) =>
      services.projectRoles.listMembers(callerOf(request), request.params.projectId),
  )

  group.put<{ Params: MemberParams; Body: { role: ProjectRole } }>(
    '/:projectId/members/:accountId',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['role'],
          properties: { role: { type: 'string', enum: [...PROJECT_ROLES] } },
          additionalProperties: false,
        },
        response: { 200: member },
      },
    },
    async (request) => {
      const { projectId, accountId } = request.params
      return services.projectRoles.setRole(
        callerOf(request),
        projectId,
        accountId,
        request.body.role,
      )
    },
  )

  group.delete<{ Params: MemberParams }>(
    '/:projectId/members/:accountId',
    { schema: { params: memberParams, response: { 204: { type: 'null' } } } },
    async (request, reply) => {
      const { projectId, accountId } = request.params
      await services.projectRoles.removeMember(callerOf(request), projectId, accountId)
      return reply.code(204).send()
    },
  )
}
