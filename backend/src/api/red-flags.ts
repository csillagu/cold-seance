import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: 'string', format: 'date' } as const

const flaggedTask = {
  type: 'object',
  required: ['id', 'projectId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
  },
} as const

const personDay = {
  type: 'object',
  required: ['accountId', 'date'],
  properties: { accountId: { type: 'string', format: 'uuid' }, date: day },
} as const

const redFlag = {
  type: 'object',
  required: ['id', 'kind', 'projectId', 'raisedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    kind: {
      type: 'string',
      enum: [
        'overload',
        'assignee-unavailable',
        'fixed-date-milestone-pushed',
        'cross-project-dependency',
      ],
      description:
        '`overload`: a person is overloaded on a day, their load above their capacity, with a ' +
        'task of the project loading them that day (`accountId`, `date`). ' +
        "`assignee-unavailable`: a task's assigned people cannot do it in its time, as one of " +
        'them is overloaded (`overloads`) or on holiday (`holiday`) on a day within it (`task`). ' +
        '`fixed-date-milestone-pushed` and `cross-project-dependency`: a violation of `task` ' +
        'blocked by `blocker`, as the project violations give it.',
    },
    projectId: { type: 'string', format: 'uuid', description: 'The project it is raised in' },
    raisedAt: {
      type: 'string',
      format: 'date-time',
      description: 'When the flag appeared in the project',
    },
    accountId: {
      type: 'string',
      format: 'uuid',
      description: 'The person overloaded (`overload`)',
    },
    date: { ...day, description: 'The day the person is overloaded (`overload`)' },
    task: {
      ...flaggedTask,
      description: 'The task in red (`assignee-unavailable`), or blocked by `blocker`',
    },
    overloads: {
      type: 'array',
      items: personDay,
      description:
        'The days within the task on which one of its assigned people is overloaded ' +
        '(`assignee-unavailable`)',
    },
    holiday: {
      type: 'boolean',
      description:
        'Whether holidays leave the task fewer working days in its time than its duration ' +
        '(`assignee-unavailable`)',
    },
    blocker: { ...flaggedTask, description: 'What `task` is blocked by (a violation)' },
    crossProject: {
      type: 'boolean',
      description: 'Whether `task` and `blocker` lie in different projects (a violation)',
    },
    start: { ...day, description: 'The day `task` starts (a violation)' },
    blockerFinish: { ...day, description: 'The day `blocker` finishes (a violation)' },
  },
} as const

/**
 * The route of a project's red flags (SC-043, SC-026). It only translates the request; the red
 * flag register decides what the caller sees (DD-039).
 */
export const redFlagRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/red-flags',
    {
      schema: {
        description:
          'The red flags currently raised in the project, in the order they appeared: each ' +
          "person overloaded on a day one of the project's tasks loads them, each task whose " +
          'assigned people cannot do it in its time, and each violation that involves a task of ' +
          'the project. One across a project boundary is given only to a caller who can read both.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: redFlag } },
      },
    },
    async (request) => {
      const flags = await services.redFlags.redFlagsOf(callerOf(request), request.params.projectId)
      return flags.map(({ id, kind, projectId, raisedAt, detail }) => ({
        id,
        kind,
        projectId,
        raisedAt: raisedAt.toISOString(),
        ...detail,
      }))
    },
  )
}
