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
 * The routes of projects (SC-017, SC-026): create a project, and list the projects the caller
 * holds a role in. They only translate the request; the project service decides what is allowed
 * (DD-039).
 */
export const projectRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.get(
    '/',
    { schema: { response: { 200: { type: 'array', items: project } } } },
    async (request) => services.projects.listProjects(callerOf(request)),
  )

  group.post<{ Body: { name: string } }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 201: project },
      },
    },
    async (request, reply) => {
      const created = await services.projects.createProject(callerOf(request), {
        name: request.body.name,
      })
      return reply.code(201).send(created)
    },
  )
}
