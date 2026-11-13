import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const taskPerson = {
  type: 'object',
  required: ['accountId', 'username', 'canReadProject'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
    canReadProject: {
      type: 'boolean',
      description:
        "Whether the person can read the task's project. Someone who cannot lost access after " +
        'being added; the editors mark them.',
    },
  },
} as const

/**
 * The route of the people on a task (SC-099, SC-100, SC-026): who its eligibility expression and
 * assignment name, by username, for the editors to name and mark. It only translates the request;
 * the service decides who may read it (DD-039).
 */
export const taskPeopleRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { taskId: string } }>(
    '/:taskId/people',
    {
      schema: {
        description:
          "Everyone the task's eligibility expression or assignment names, each once, by " +
          'username in alphabetical order, with whether they can read its project. Anyone who ' +
          'can read the task can read it.',
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: taskPerson } },
      },
    },
    async (request) => services.taskPeople.peopleOnTask(callerOf(request), request.params.taskId),
  )
}
