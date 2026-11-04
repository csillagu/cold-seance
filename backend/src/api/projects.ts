import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const project = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
  },
} as const

/**
 * The routes of projects (SC-017, SC-051, SC-116, SC-058, SC-026): create a project, adding it to
 * groups if asked, list the projects the
 * caller can read, search the projects they can read by part of the name, and read one,
 * which someone who cannot see it is told is not visible to them.
 * They only translate the request; the project service decides what is allowed (DD-039).
 */
export const projectRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: project } } } },
    async (request) => services.projects.listProjects(callerOf(request)),
  )

  group.get<{ Querystring: { text: string } }>(
    '/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string' } },
        },
        response: { 200: { type: 'array', items: project } },
      },
    },
    async (request) => services.projects.searchProjects(callerOf(request), request.query.text),
  )

  group.get<{ Params: { projectId: string } }>(
    '/:projectId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: project },
      },
    },
    async (request) => services.projects.getProject(callerOf(request), request.params.projectId),
  )

  group.post<{ Body: { name: string; groupIds?: string[] } }>(
    '/',
    {
      schema: {
        description:
          'Creates a project, makes the caller its admin, and adds it to the groups `groupIds`, ' +
          'if given: anyone can add a new project to any group. Refused with 404, with nothing ' +
          'created, if any of the groups does not exist.',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            groupIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
          additionalProperties: false,
        },
        response: { 201: project },
      },
    },
    async (request, reply) => {
      const { name, groupIds } = request.body
      const created = await services.projects.createProject(callerOf(request), {
        name,
        ...(groupIds === undefined ? {} : { groupIds }),
      })
      return reply.code(201).send(created)
    },
  )
}
