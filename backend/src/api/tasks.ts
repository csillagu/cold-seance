import type { FastifyPluginAsync } from 'fastify'
import { MILESTONE_VARIANTS, TASK_STATUSES } from '../db/schema.ts'
import type { TaskInput } from '../service/tasks.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const nullable = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type: [type, 'null'], ...extra }) as const

/** A task as the routes send it (FR-001). */
const task = {
  type: 'object',
  required: [
    'id',
    'projectId',
    'title',
    'description',
    'status',
    'plannedStart',
    'plannedFinish',
    'durationWorkingDays',
    'effort',
    'aiShare',
    'milestone',
    'githubIssue',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string', enum: [...TASK_STATUSES] },
    plannedStart: nullable('string', { format: 'date' }),
    plannedFinish: nullable('string', { format: 'date' }),
    durationWorkingDays: nullable('integer', {
      description: 'The duration in whole working days',
    }),
    effort: nullable('number'),
    aiShare: nullable('number', { description: 'The share done by AI, in percent' }),
    milestone: {
      type: ['object', 'null'],
      description:
        'Whether the task is a milestone: pinned to a fixed date, with that date, or floating, ' +
        'with none. Null for a task that is not a milestone.',
      required: ['variant', 'date'],
      properties: {
        variant: { type: 'string', enum: [...MILESTONE_VARIANTS] },
        date: nullable('string', { format: 'date' }),
      },
    },
    githubIssue: {
      type: 'null',
      description: 'The linked GitHub issue; none until the task is assigned to a repository',
    },
  },
} as const

/**
 * The fields a task is created with or changed by. The types only shape the request; the task
 * service decides what values are valid (DD-039).
 */
const fieldProperties = {
  title: { type: 'string' },
  description: { type: 'string' },
  plannedStart: nullable('string'),
  plannedFinish: nullable('string'),
  durationWorkingDays: nullable('number', {
    description: 'The duration in whole working days',
  }),
  effort: nullable('number'),
  aiShare: nullable('number', { description: 'The share done by AI, in percent' }),
  milestone: {
    type: ['object', 'null'],
    description:
      'Makes the task a milestone when it is created: `{ "variant": "fixed-date", "date": ' +
      '"YYYY-MM-DD" }` or `{ "variant": "floating" }`; null for a task that is not one. Once ' +
      'created, a task cannot become a milestone or stop being one, nor a milestone change ' +
      "variant; a fixed-date milestone's date can be changed.",
    properties: { variant: { type: 'string' }, date: nullable('string') },
  },
} as const

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const

const taskParams = {
  type: 'object',
  required: ['taskId'],
  properties: { taskId: { type: 'string', format: 'uuid' } },
} as const

/**
 * The routes of a project's tasks (SC-001, SC-026): list a project's tasks, scheduled or not, and
 * create one in it. They only translate the request; the task service decides what is allowed
 * (DD-039).
 */
export const projectTaskRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/tasks',
    { schema: { params: projectParams, response: { 200: { type: 'array', items: task } } } },
    async (request) => services.tasks.listTasks(callerOf(request), request.params.projectId),
  )

  group.post<{ Params: { projectId: string }; Body: TaskInput }>(
    '/:projectId/tasks',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['title'],
          properties: fieldProperties,
          additionalProperties: false,
        },
        response: { 201: task },
      },
    },
    async (request, reply) => {
      const created = await services.tasks.createTask(
        callerOf(request),
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(created)
    },
  )
}

/**
 * The routes of one task (SC-001, SC-026): read it, and change some of its fields. They only
 * translate the request; the task service decides what is allowed (DD-039).
 */
export const taskRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.get<{ Params: { taskId: string } }>(
    '/:taskId',
    { schema: { params: taskParams, response: { 200: task } } },
    async (request) => services.tasks.getTask(callerOf(request), request.params.taskId),
  )

  group.patch<{ Params: { taskId: string }; Body: TaskInput }>(
    '/:taskId',
    {
      schema: {
        params: taskParams,
        body: { type: 'object', properties: fieldProperties, additionalProperties: false },
        response: { 200: task },
      },
    },
    async (request) =>
      services.tasks.updateTask(callerOf(request), request.params.taskId, request.body),
  )
}
