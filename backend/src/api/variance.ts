import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: ['string', 'null'], format: 'date' } as const

const datePair = (whose: string) =>
  ({
    type: 'object',
    required: ['start', 'finish'],
    properties: {
      start: { ...day, description: `${whose} start; a milestone's day; null for none` },
      finish: { ...day, description: `${whose} finish; a milestone's day; null for none` },
    },
  }) as const

const days = (which: string) =>
  ({
    type: ['integer', 'null'],
    description:
      `The ${which} variance in working days of the global calendar, leaving out its weekend ` +
      `days and company holidays: the actual ${which}, or the planned one where ` +
      `there is no actual ${which} yet, minus the baseline's; positive is later. Null where ` +
      'either has no date.',
  }) as const

const taskVariance = {
  type: 'object',
  required: ['taskId', 'title', 'milestone', 'baseline', 'planned', 'actual', 'variance'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    title: { type: 'string', description: "The task's title as it is now" },
    milestone: { type: 'boolean', description: 'Whether the task is a milestone' },
    baseline: {
      ...datePair("The baseline's"),
      type: ['object', 'null'],
      description: "The task's dates in the baseline; null if it was created after the baseline",
    },
    planned: datePair("The task's planned"),
    actual: datePair("The task's actual"),
    variance: {
      type: 'object',
      required: ['start', 'finish'],
      properties: { start: days('start'), finish: days('finish') },
    },
  },
} as const

const variance = {
  type: 'object',
  required: ['baseline', 'tasks'],
  properties: {
    baseline: {
      type: 'object',
      required: ['id', 'projectId', 'name', 'savedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        projectId: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        savedAt: {
          type: 'string',
          format: 'date-time',
          description: 'When the baseline was saved',
        },
      },
    },
    tasks: {
      type: 'array',
      items: taskVariance,
      description: 'Every task the project has now, in the order they were created',
    },
  },
} as const

/**
 * The route of a project's variance against one of its baselines (SC-044, SC-026). It only
 * translates the request; the variance calculator computes it and decides who may read it
 * (DD-039).
 */
export const varianceRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { baselineId: string } }>(
    '/:baselineId/variance',
    {
      schema: {
        description:
          "The variance of the baseline's project against it, computed now and not stored: for " +
          'each task and milestone, its baseline, planned and actual dates, and each date’s ' +
          'variance, the actual date, or the planned one where there is none yet, minus the ' +
          "baseline's.",
        params: {
          type: 'object',
          required: ['baselineId'],
          properties: { baselineId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: variance },
      },
    },
    async (request) =>
      services.variance.varianceAgainst(callerOf(request), request.params.baselineId),
  )
}
