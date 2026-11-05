import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: 'string', format: 'date' } as const

const taskLoad = {
  type: 'object',
  required: ['taskId', 'projectId', 'title', 'load'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    load: { type: 'number', description: 'The percentage the task puts on the person that day' },
  },
} as const

const dayLoad = {
  type: 'object',
  required: ['date', 'load', 'tasks', 'otherProjects', 'capacity', 'overloaded'],
  properties: {
    date: day,
    load: {
      type: 'number',
      description: "The person's whole load that day, across all projects, in percent",
    },
    tasks: {
      type: 'array',
      items: taskLoad,
      description: 'The tasks behind the load in projects the caller can read',
    },
    otherProjects: {
      type: 'number',
      description: 'The load from projects the caller cannot read, in percent',
    },
    capacity: {
      type: ['integer', 'null'],
      description:
        "The person's capacity that day, in percent, 0 on an absence day; null when the caller " +
        "may not read the person's capacity",
    },
    overloaded: {
      type: ['boolean', 'null'],
      description:
        'Whether the person is overloaded that day, their load above their capacity; null when ' +
        "the caller may not read the person's capacity",
    },
  },
} as const

const personLoad = {
  type: 'object',
  required: ['accountId', 'from', 'to', 'days'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    from: day,
    to: day,
    days: { type: 'array', items: dayLoad, description: 'Each day from `from` to `to`, in order' },
  },
} as const

/**
 * The route of a person's daily load (SC-006, SC-026). It only translates the request; the daily
 * person load aggregator decides what the caller sees (DD-039).
 */
export const personLoadRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { accountId: string }; Querystring: { from?: string; to?: string } }>(
    '/:accountId/load',
    {
      schema: {
        description:
          "A person's load on each day from `from` to `to`, both included, across all projects: " +
          'the tasks behind it in projects the caller can read, and the rest as a percentage.',
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
        // Both dates must be there, but they carry no format, so that the aggregator alone
        // decides whether a date is valid, the same through every channel (DD-039).
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', description: 'The first day, YYYY-MM-DD' },
            to: { type: 'string', description: 'The last day, included, YYYY-MM-DD' },
          },
          additionalProperties: false,
        },
        response: { 200: personLoad },
      },
    },
    async (request) =>
      services.dailyLoad.loadOf(callerOf(request), request.params.accountId, request.query),
  )
}
