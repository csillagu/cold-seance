import type { FastifyPluginAsync } from 'fastify'
import { MILESTONE_VARIANTS, TASK_STATUSES } from '../db/schema.ts'
import type { TaskInput } from '../service/tasks.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const nullable = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type: [type, 'null'], ...extra }) as const

const person = { type: 'string', format: 'uuid', description: "A person, by their account's id" }

/** An AND (`all`) or OR (`any`) whose operands are `operand`. */
const andOr = (operand: Record<string, unknown>) =>
  (['all', 'any'] as const).map((operator) => ({
    type: 'object',
    required: [operator],
    properties: { [operator]: { type: 'array', minItems: 1, items: operand } },
    additionalProperties: false,
  }))

/**
 * An eligibility expression as the routes send it (FR-028, DD-038): a person, or an AND or OR of
 * people and of ANDs and ORs of people, at most two levels deep.
 */
const eligibility = {
  description:
    'Who can do the task: a person, or `{ "all": [...] }` (AND) or `{ "any": [...] }` (OR) of ' +
    'people and, one level down, of ANDs and ORs of people. For example `A AND (B OR C)` is ' +
    '`{ "all": ["A", { "any": ["B", "C"] }] }`. Null when the task has none.',
  anyOf: [{ type: 'null' }, person, ...andOr({ anyOf: [person, ...andOr(person)] })],
} as const

/** A task as the routes send it (FR-001). */
export const task = {
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
    'personLoad',
    'milestone',
    'eligibility',
    'assignees',
    'loadOverrides',
    'withoutReadAccess',
    'actualStart',
    'actualFinish',
    'repositoryId',
    'githubIssue',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string', enum: [...TASK_STATUSES] },
    plannedStart: nullable('string', {
      format: 'date',
      description:
        'The planned start. For a task blocked by tasks of its project that have a finish, the ' +
        'next working day after the last of them finishes; for a parent, its earliest subtask date',
    }),
    plannedFinish: nullable('string', {
      format: 'date',
      description:
        'The planned finish. For a task with a start and a duration, the day its duration runs ' +
        'out, counted over its working days; for a parent, its latest subtask date',
    }),
    durationWorkingDays: nullable('integer', {
      description: 'The duration in whole working days',
    }),
    effort: nullable('number'),
    aiShare: nullable('number', { description: 'The share done by AI, in percent' }),
    personLoad: nullable('number', {
      description:
        'The load the task puts on each person assigned to it over its whole duration, in ' +
        'percent: 100 minus its AI share, or for an AI-only task the percentage it was given. ' +
        'An assignment may override it for its person. Null for a milestone.',
    }),
    milestone: {
      type: ['object', 'null'],
      description:
        'Whether the task is a milestone: pinned to a fixed date, with that date, or floating, ' +
        'with the date the scheduler places it on: the day the last of its blockers in its ' +
        'project finishes, or null while none of them has a finish. Null for a task that is not ' +
        'a milestone.',
      required: ['variant', 'date'],
      properties: {
        variant: { type: 'string', enum: [...MILESTONE_VARIANTS] },
        date: nullable('string', { format: 'date' }),
      },
    },
    eligibility,
    assignees: {
      type: 'array',
      items: person,
      description: 'Who will do the task, in order; empty while nobody is assigned',
    },
    loadOverrides: {
      type: 'object',
      additionalProperties: { type: 'number' },
      description:
        "The load, in percent, that replaces the task's person load for single assignees, by " +
        'account id; empty while none does',
    },
    withoutReadAccess: {
      type: 'array',
      items: person,
      description:
        'The people in its eligibility or assignment who cannot read its project, for the UI to ' +
        'mark. They lost access after being added; they stay until removed, and cannot be added again.',
    },
    actualStart: nullable('string', {
      format: 'date',
      description: 'The date the task was started; null while it has not been',
    }),
    actualFinish: nullable('string', {
      format: 'date',
      description: 'The date the task was finished; null while it is not finished',
    }),
    repositoryId: nullable('string', {
      format: 'uuid',
      description:
        'The registered repository the task is assigned to, by its id; null while it is ' +
        'assigned to none',
    }),
    githubIssue: {
      type: ['object', 'null'],
      description:
        'The linked GitHub issue, created once the task is assigned to a repository; null while ' +
        'it has none',
      required: ['repositoryId', 'number'],
      properties: {
        repositoryId: {
          type: 'string',
          format: 'uuid',
          description: "The registered repository the issue is in, by the tool's id for it",
        },
        number: { type: 'integer', description: 'The issue number in that repository' },
      },
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
  plannedStart: nullable('string', {
    description:
      "The planned start, YYYY-MM-DD. Refused with 400 on one of the task's non-working days: a " +
      'weekend day, a company holiday, or a day off of someone assigned to it. The scheduler ' +
      'sets the start of a task blocked by tasks of its project, and of a parent.',
  }),
  plannedFinish: nullable('string', {
    description:
      'The planned finish, YYYY-MM-DD, for a task with no duration; with a start and a ' +
      'duration, the scheduler derives it. Refused with 400 on a non-working day of the task.',
  }),
  durationWorkingDays: nullable('number', {
    description: 'The duration in whole working days',
  }),
  effort: nullable('number'),
  aiShare: nullable('number', { description: 'The share done by AI, in percent' }),
  // No type, so that Fastify does not coerce a value: the service alone decides what a valid
  // person load is, the same for every channel (DD-039).
  personLoad: {
    description:
      "The task's person load, in percent, which can be set only for an AI-only task (AI share " +
      '100): any number of zero or more, such as 0, 0.5 or 150. Null puts it back to the ' +
      "default. Any other task's person load is 100 minus its AI share.",
  },
  milestone: {
    type: ['object', 'null'],
    description:
      'Makes the task a milestone when it is created: `{ "variant": "fixed-date", "date": ' +
      '"YYYY-MM-DD" }` or `{ "variant": "floating" }`; null for a task that is not one. Once ' +
      'created, a task cannot become a milestone or stop being one, nor a milestone change ' +
      "variant; a fixed-date milestone's date can be changed.",
    properties: { variant: { type: 'string' }, date: nullable('string') },
  },
  eligibility: {
    description:
      'Who can do the task, as an AND/OR expression over people at most two levels deep: a ' +
      'person\'s account id, or `{ "all": [...] }` (AND) or `{ "any": [...] }` (OR) of account ' +
      'ids and of ANDs and ORs of account ids. Null for none. Everyone it adds must be able to ' +
      'read the project. A milestone has none.',
  },
  // No type, so that Fastify does not coerce a lone id into a list: the service alone decides what
  // a list of assignees is, the same for every channel (DD-039).
  assignees: {
    description:
      'Who will do the task: a list of account ids, each once, in order; empty for nobody. They need not ' +
      'be in the eligibility expression, but everyone added must be able to read the project. ' +
      'Nobody can be assigned to a milestone.',
  },
  // No property types, so that Fastify does not coerce a value: the service alone decides what a
  // valid override is, the same for every channel (DD-039).
  loadOverrides: {
    type: 'object',
    description:
      "Overrides the task's person load for single assignees: an object from assignee's account " +
      'id to the load, in percent, a number of zero or more, such as `{ "<id>": 30 }`. It ' +
      'replaces all the overrides; `{}` removes them. Each key must be one of the assignees. Left ' +
      'out, the overrides of people who stay assigned are kept.',
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

/**
 * The route of a task's status (SC-003, SC-026): start it, put it on hold, finish it, or set it
 * back to in progress, which records its actual start or finish. It only translates the request;
 * the status transitions decide what is allowed (DD-039).
 */
export const taskStatusRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.put<{ Params: { taskId: string }; Body: { status: unknown } }>(
    '/:taskId/status',
    {
      schema: {
        params: taskParams,
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              description:
                'The status to set: `in-progress` to start the task or set it back to in progress, ' +
                '`on-hold` to put it on hold, `done` to finish it. Starting records its actual ' +
                'start, finishing its actual finish, and setting a finished task back to in ' +
                'progress clears its actual finish; putting it on hold changes nothing else. ' +
                'Refused with 409 when it would finish a task one of whose subtasks is open, or ' +
                'start or finish a task before every task blocking it is done.',
            },
          },
          additionalProperties: false,
        },
        response: { 200: task },
      },
    },
    async (request) =>
      services.taskStatus.setStatus(callerOf(request), request.params.taskId, request.body.status),
  )
}

/**
 * The route that cancels a task (SC-038, SC-026). Cancelling passes the task's blockers on to the
 * tasks it blocked. It only translates the request; the task cancellation decides what is allowed
 * (DD-039).
 */
export const taskCancellationRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.post<{ Params: { taskId: string } }>(
    '/:taskId/cancel',
    {
      schema: {
        description:
          'Cancels the task. It stays in its project, cancelled. Each task it blocked is then ' +
          'blocked by whatever it was blocked by instead. Cancelling a cancelled task changes ' +
          'nothing. Refused with 400 for a finished task, and with 409 for a milestone that ' +
          "blocks a task of another project. Only the project's read-write members and admins " +
          'can cancel a task.',
        params: taskParams,
        // Nothing to send: the body may be left out, or be an empty object.
        body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
        response: { 200: task },
      },
    },
    async (request) => services.taskCancellation.cancel(callerOf(request), request.params.taskId),
  )
}

/**
 * The route that assigns a task to a repository (SC-036, SC-026). It only translates the request;
 * the task repository assignment decides what is allowed (DD-039).
 */
export const taskRepositoryRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.put<{ Params: { taskId: string }; Body: { repositoryId: unknown } }>(
    '/:taskId/repository',
    {
      schema: {
        description:
          'Assigns the task to a repository: one of the repositories its project pulls issues ' +
          'from, by its id in the tool. Refused with 400 for any other repository. Only the ' +
          "project's read-write members and admins can assign a task.",
        params: taskParams,
        body: {
          type: 'object',
          required: ['repositoryId'],
          // No type, so that Fastify does not coerce a value: the service alone decides which
          // repositories a task can be assigned to, the same for every channel (DD-039).
          properties: {
            repositoryId: { description: 'The id of the repository, as the tool registered it' },
          },
          additionalProperties: false,
        },
        response: { 200: task },
      },
    },
    async (request) =>
      services.taskRepository.assignRepository(
        callerOf(request),
        request.params.taskId,
        request.body.repositoryId,
      ),
  )
}
