import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const receiving = {
  type: 'object',
  required: ['repository', 'pulls'],
  properties: {
    repository: {
      type: 'object',
      required: ['id', 'githubId', 'owner', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        githubId: { type: 'integer' },
        owner: { type: 'string' },
        name: { type: 'string' },
      },
    },
    pulls: {
      type: 'boolean',
      description:
        'Whether the project still pulls issues from the repository. While it does not, no ' +
        "project receives the repository's new issues until it gives the role up.",
    },
  },
} as const

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const

const receivingParams = {
  type: 'object',
  required: ['projectId', 'repositoryId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    repositoryId: { type: 'string', format: 'uuid' },
  },
} as const

interface ReceivingParams {
  projectId: string
  repositoryId: string
}

/**
 * The routes of the receiving project register (SC-111, SC-026): read the repositories a project
 * is the receiving project of, mark it as one, and give the role up. They only translate the
 * request; the receiving project service decides what is allowed (DD-039).
 */
export const receivingProjectRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { projectId: string } }>(
    '/:projectId/receiving-repositories',
    {
      schema: {
        description:
          'The repositories the project is the receiving project of: the one project that gets ' +
          "each one's new issues. Readable by anyone with a role in the project.",
        params: projectParams,
        response: { 200: { type: 'array', items: receiving } },
      },
    },
    async (req) => services.receivingProjects.listReceiving(callerOf(req), req.params.projectId),
  )

  routes.put<{ Params: ReceivingParams }>(
    '/:projectId/receiving-repositories/:repositoryId',
    {
      schema: {
        description:
          "Marks the project as the repository's receiving project. Only the project's admins " +
          'can, and only for a repository the project pulls issues from (else 400). Refused ' +
          'with 409 while another project is the receiving one, which stays. Marking the ' +
          'project that already is the receiving one changes nothing.',
        params: receivingParams,
        // Nothing to send: the body may be left out, or be an empty object.
        body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
        response: { 200: receiving },
      },
    },
    async (req) =>
      services.receivingProjects.markReceiving(
        callerOf(req),
        req.params.projectId,
        req.params.repositoryId,
      ),
  )

  routes.delete<{ Params: ReceivingParams }>(
    '/:projectId/receiving-repositories/:repositoryId',
    {
      schema: {
        description:
          "Gives up the project's role as the repository's receiving project: the repository " +
          "then has none until a project is marked again. Only the project's admins can; " +
          'refused with 409 unless the project is the receiving one.',
        params: receivingParams,
        response: { 204: { type: 'null' } },
      },
    },
    async (req, reply) => {
      await services.receivingProjects.giveUpReceiving(
        callerOf(req),
        req.params.projectId,
        req.params.repositoryId,
      )
      return reply.code(204).send()
    },
  )
}
