import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: ['string', 'null'], format: 'date' } as const

const summaryProperties = {
  id: { type: 'string', format: 'uuid' },
  projectId: { type: 'string', format: 'uuid' },
  name: { type: 'string' },
  savedAt: { type: 'string', format: 'date-time', description: 'When the baseline was saved' },
} as const

const summary = {
  type: 'object',
  required: ['id', 'projectId', 'name', 'savedAt'],
  properties: summaryProperties,
} as const

const baselineTask = {
  type: 'object',
  required: ['taskId', 'title', 'plannedStart', 'plannedFinish'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    title: { type: 'string', description: "The task's title as it is now" },
    plannedStart: {
      ...day,
      description:
        "The task's planned start when the baseline was saved; a milestone's day; null for none",
    },
    plannedFinish: {
      ...day,
      description:
        "The task's planned finish when the baseline was saved; a milestone's day; null for none",
    },
  },
} as const

const baseline = {
  type: 'object',
  required: [...summary.required, 'tasks'],
  properties: {
    ...summaryProperties,
    tasks: {
      type: 'array',
      items: baselineTask,
      description: 'Every task the project had when it was saved, in the order they were created',
    },
  },
} as const

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const

/**
 * The routes of a project's baselines (SC-009, SC-026): save one under a name, and list them. They
 * only translate the request; the baseline service decides who may do what (DD-039).
 */
export const projectBaselineRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.post<{ Params: { projectId: string }; Body: { name: string } }>(
    '/:projectId/baselines',
    {
      schema: {
        description:
          "Saves, under a name, a snapshot of every task's planned start and finish in the " +
          "project. Only the project's read-write members and admins can save one; the name must " +
          'not be one another baseline of the project has.',
        params: projectParams,
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 201: baseline },
      },
    },
    async (request, reply) => {
      const saved = await services.baselines.saveBaseline(
        callerOf(request),
        request.params.projectId,
        { name: request.body.name },
      )
      return reply.code(201).send(saved)
    },
  )

  routes.get<{ Params: { projectId: string } }>(
    '/:projectId/baselines',
    {
      schema: {
        description: "The project's baselines, in the order they were saved.",
        params: projectParams,
        response: { 200: { type: 'array', items: summary } },
      },
    },
    async (request) =>
      services.baselines.listBaselines(callerOf(request), request.params.projectId),
  )
}

/** The route of one baseline (SC-009, SC-026): read it, with the dates it holds. */
export const baselineRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { baselineId: string } }>(
    '/:baselineId',
    {
      schema: {
        description: 'The baseline, with the planned dates it holds.',
        params: {
          type: 'object',
          required: ['baselineId'],
          properties: { baselineId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: baseline },
      },
    },
    async (request) => services.baselines.getBaseline(callerOf(request), request.params.baselineId),
  )
}
