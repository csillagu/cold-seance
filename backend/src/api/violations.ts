import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: 'string', format: 'date' } as const

const violationTask = {
  type: 'object',
  required: ['id', 'projectId', 'title'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
  },
} as const

const violation = {
  type: 'object',
  required: ['kind', 'task', 'blocker', 'crossProject', 'start', 'blockerFinish'],
  properties: {
    kind: {
      type: 'string',
      enum: ['fixed-date-milestone-pushed', 'cross-project-dependency'],
      description:
        '`fixed-date-milestone-pushed`: work a fixed-date milestone depends on finishes after its ' +
        "date. `cross-project-dependency`: another project's milestone lies after the start of a " +
        'task that depends on it.',
    },
    task: { ...violationTask, description: 'The task blocked by `blocker`' },
    blocker: { ...violationTask, description: 'What `task` is blocked by' },
    crossProject: {
      type: 'boolean',
      description: 'Whether `task` and `blocker` lie in different projects',
    },
    start: {
      ...day,
      description: "The day `task` starts: a fixed-date milestone's date, or the task's start",
    },
    blockerFinish: { ...day, description: 'The day `blocker` finishes, after `start`' },
  },
} as const

/**
 * The route of a project's violations (SC-007, SC-026), for the Gantt to show in red. It only
 * translates the request; the violation detector decides what the caller sees (DD-039).
 */
export const violationRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/violations',
    {
      schema: {
        description:
          'The violations shown in red that involve a task of the project: each fixed-date ' +
          'milestone that work it depends on would push past its date, and each dependency on ' +
          "another project's milestone that lies after the dependent task's start, in either " +
          'project. One across a project boundary is given only to a caller who can read both.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: violation } },
      },
    },
    async (request) =>
      services.violations.violationsOf(callerOf(request), request.params.projectId),
  )
}
