import type { FastifyPluginAsync } from 'fastify'
import { PROJECT_ROLES, type ProjectRole } from '../service/project-roles.ts'
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

const groupParams = {
  type: 'object',
  required: ['groupId'],
  properties: { groupId: { type: 'string', format: 'uuid' } },
} as const

const memberParams = {
  type: 'object',
  required: ['groupId', 'accountId'],
  properties: {
    groupId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
  },
} as const

const project = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
  },
} as const

const projectParams = {
  type: 'object',
  required: ['groupId', 'projectId'],
  properties: {
    groupId: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
  },
} as const

interface MemberParams {
  groupId: string
  accountId: string
}

interface ProjectParams {
  groupId: string
  projectId: string
}

/**
 * The routes of groups (SC-018, SC-057, SC-058, SC-026): create a group, list every group, list a
 * group's members with their roles, give someone a role in a group, take them out of it, leave it,
 * list a group's projects, add an existing project to it, and delete it (SC-059).
 * They only translate the request; the group service decides what is
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
        params: groupParams,
        response: { 200: { type: 'array', items: member } },
      },
    },
    async (request) => services.groups.listMembers(callerOf(request), request.params.groupId),
  )

  routes.put<{ Params: MemberParams; Body: { role: ProjectRole } }>(
    '/:groupId/members/:accountId',
    {
      schema: {
        description:
          'Gives the person the role in the group, adding them as a member or changing their ' +
          "role. Only the group's admins can; refused with 409 if it would leave the group " +
          'without an admin.',
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
      const { groupId, accountId } = request.params
      return services.groups.setMemberRole(callerOf(request), groupId, accountId, request.body.role)
    },
  )

  routes.delete<{ Params: MemberParams }>(
    '/:groupId/members/:accountId',
    {
      schema: {
        description:
          "Takes the person out of the group. Only the group's admins can; refused with 404 if " +
          "the person is not a member, and with 409 if they are the group's last admin.",
        params: memberParams,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      const { groupId, accountId } = request.params
      await services.groups.removeMember(callerOf(request), groupId, accountId)
      return reply.code(204).send()
    },
  )

  routes.post<{ Params: { groupId: string } }>(
    '/:groupId/leave',
    {
      schema: {
        description:
          'Takes the caller out of the group, whatever role they hold in it. Refused with 404 ' +
          "if they are not a member, and with 409 if they are the group's last admin.",
        params: groupParams,
        // Nothing to send: the body may be left out, or be an empty object.
        body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.groups.leaveGroup(callerOf(request), request.params.groupId)
      return reply.code(204).send()
    },
  )

  routes.get<{ Params: { groupId: string } }>(
    '/:groupId/projects',
    {
      schema: {
        description:
          "The group's projects, by name, among only those the caller can see: a member of the " +
          'group sees them all.',
        params: groupParams,
        response: { 200: { type: 'array', items: project } },
      },
    },
    async (request) => services.groups.listProjects(callerOf(request), request.params.groupId),
  )

  routes.put<{ Params: ProjectParams }>(
    '/:groupId/projects/:projectId',
    {
      schema: {
        description:
          "Adds an existing project to the group, which gives the group's members their group " +
          "role on it. Only the project's admins can; a project already in the group is left as " +
          'it is. A new project is added to groups as it is created (POST /api/projects).',
        params: projectParams,
        // Nothing to send: the body may be left out, or be an empty object.
        body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
        response: { 200: project },
      },
    },
    async (request) => {
      const { groupId, projectId } = request.params
      return services.groups.addProject(callerOf(request), groupId, projectId)
    },
  )

  routes.delete<{ Params: { groupId: string } }>(
    '/:groupId',
    {
      schema: {
        description:
          'Deletes the group, with its saved views, its members and its place in its projects; ' +
          'the projects stay. Only system admins can.',
        params: groupParams,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.groups.deleteGroup(callerOf(request), request.params.groupId)
      return reply.code(204).send()
    },
  )
}
