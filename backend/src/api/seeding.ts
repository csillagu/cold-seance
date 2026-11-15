import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const issueRef = {
  repositoryId: { type: 'string', format: 'uuid' },
  issueNumber: { type: 'integer' },
} as const

/**
 * The route that seeds a project from GitHub repositories (SC-025, SC-026). It only translates the
 * request; the seeding importer decides what is brought in and who may seed (DD-039).
 */
export const seedingRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.post<{ Params: { projectId: string }; Body: { repositoryIds: string[] } }>(
    '/:projectId/seeding',
    {
      schema: {
        description:
          'Seeds the project from the repositories `repositoryIds`, which it must pull issues ' +
          'from, all or nothing: every issue becomes a task linked to it, open ones unscheduled, ' +
          'closed ones done with their closing date as actual finish, with their sub-issue and ' +
          'blocked-by relations, assignees and Projects status. Issues that are tasks already, ' +
          'or are blocked by an issue the seeding does not bring in, are skipped. Only the ' +
          "project's admins may seed it. Refused with 409 for a repository the project does not " +
          'pull from or the tool cannot reach, and with 503, nothing imported, if GitHub cannot ' +
          'be read.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['repositoryIds'],
          properties: {
            repositoryIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            required: ['projectId', 'imported', 'skipped'],
            properties: {
              projectId: { type: 'string', format: 'uuid' },
              imported: {
                type: 'array',
                description: 'The tasks created, one for each issue brought in',
                items: {
                  type: 'object',
                  required: ['taskId', 'repositoryId', 'issueNumber'],
                  properties: { taskId: { type: 'string', format: 'uuid' }, ...issueRef },
                },
              },
              skipped: {
                type: 'array',
                description: 'The issues left out, with why',
                items: {
                  type: 'object',
                  required: ['repositoryId', 'issueNumber', 'reason'],
                  properties: {
                    ...issueRef,
                    reason: {
                      type: 'string',
                      enum: ['already-in-project', 'in-another-project', 'blocked-from-outside'],
                      description:
                        'already-in-project: a task of this project already, as after an ' +
                        'earlier seeding; in-another-project: a task of another project; ' +
                        'blocked-from-outside: blocked by an issue this seeding does not bring in',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) =>
      services.seeding.seed(
        callerOf(request),
        request.params.projectId,
        request.body.repositoryIds,
      ),
  )
}
