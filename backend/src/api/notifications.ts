import type { FastifyPluginAsync } from 'fastify'
import { NOTIFICATION_KINDS } from '../db/schema.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'
import { redFlag } from './red-flags.ts'

const uuid = { type: 'string', format: 'uuid' } as const

/** A task a notification names, or `null` where the reader cannot read its project. */
const notifiedTask = {
  type: ['object', 'null'],
  required: ['id', 'projectId'],
  properties: { id: uuid, projectId: uuid },
} as const

const flag = redFlag.properties

const notification = {
  type: 'object',
  required: ['id', 'kind', 'createdAt', 'detail'],
  properties: {
    id: uuid,
    kind: {
      type: 'string',
      enum: [...NOTIFICATION_KINDS],
      description:
        '`red-flag`: a new red flag in a project the reader is subscribed to, about an issue they ' +
        "are subscribed to, or, of another project's milestone now after a task's start, in a " +
        'project they are admin of. `proposal-waiting`: a proposal waiting for their review. ' +
        "`repository-request`: a project's request for a repository they are admin of, waiting " +
        "for them. `token-refused`: GitHub refused a GitHub function's personal access token as " +
        'expired or revoked (to system admins). `github-revert`: a change made on GitHub that the ' +
        'tool reverted, on an issue or in a project the reader is subscribed to.',
    },
    createdAt: { type: 'string', format: 'date-time' },
    detail: {
      type: 'object',
      description:
        'What the notification tells, by its kind. A project the reader cannot read is left out ' +
        'of `projectIds`, and a task of one is given as null.',
      properties: {
        flagKind: { ...flag.kind, description: 'The kind of the red flag (`red-flag`)' },
        projectIds: {
          type: 'array',
          items: uuid,
          description:
            'The projects the red flag is raised in (`red-flag`), or the proposal changes ' +
            '(`proposal-waiting`)',
        },
        accountId: flag.accountId,
        date: flag.date,
        task: {
          ...notifiedTask,
          description: `${flag.task.description}; the task whose issue it is (\`github-revert\`)`,
        },
        overloads: flag.overloads,
        holiday: flag.holiday,
        blocker: { ...notifiedTask, description: flag.blocker.description },
        crossProject: flag.crossProject,
        start: flag.start,
        blockerFinish: flag.blockerFinish,
        proposalId: { ...uuid, description: 'The proposal waiting (`proposal-waiting`)' },
        requestId: { ...uuid, description: 'The request (`repository-request`)' },
        project: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: uuid, name: { type: 'string' } },
          description: 'The project asking for the repository (`repository-request`)',
        },
        repository: {
          type: 'object',
          required: ['id', 'owner', 'name'],
          properties: { id: uuid, owner: { type: 'string' }, name: { type: 'string' } },
          description:
            'The repository asked for (`repository-request`), or of the issue (`github-revert`)',
        },
        requestedBy: {
          type: 'object',
          required: ['accountId', 'username'],
          properties: { accountId: uuid, username: { type: 'string' } },
          description: 'Who asked for it (`repository-request`)',
        },
        number: {
          type: 'integer',
          description:
            'The issue (`github-revert`): for a deleted one, the issue created in its place',
        },
        change: {
          type: 'string',
          enum: ['close', 'delete', 'reopen', 'not-planned', 'start', 'planning'],
          description:
            'What was reverted (`github-revert`): a close, a deletion, a reopening, a close as ' +
            "not planned, a move to the started option, or an edit of the issue's planning",
        },
        parts: {
          type: 'array',
          items: { type: 'string', enum: ['assignees', 'milestone', 'parent', 'blocked-by'] },
          description: "The parts of the issue's planning set back (`github-revert`, `planning`)",
        },
        function: {
          type: 'string',
          enum: ['readIssues', 'writeIssues', 'projectsStatus'],
          description: 'The GitHub function the refused token is given for (`token-refused`)',
        },
      },
    },
  },
} as const

/**
 * The route of the caller's notifications (SC-012, SC-026). It only translates the request; the
 * notification module decides what the caller gets (DD-039).
 */
export const notificationRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get(
    '/',
    {
      schema: {
        description:
          "The caller's in-app notifications, newest first. Reading them leaves them in place.",
        response: { 200: { type: 'array', items: notification } },
      },
    },
    async (request) => {
      const found = await services.notifications.notificationsOf(callerOf(request))
      return found.map(({ createdAt, ...rest }) => ({
        ...rest,
        createdAt: createdAt.toISOString(),
      }))
    },
  )
}

const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const

const taskParams = {
  type: 'object',
  required: ['taskId'],
  properties: { taskId: uuid },
} as const

// Nothing to send: the body may be left out, or be an empty object.
const noBody = { type: ['object', 'null'], properties: {}, additionalProperties: false } as const

/**
 * The routes of the caller's subscriptions to projects and issues (SC-012, SC-026). They only
 * translate the request; the notification module decides (DD-039).
 */
export const subscriptionRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get(
    '/',
    {
      schema: {
        description:
          'The projects and issues the caller is subscribed to. A project is `automatic` when ' +
          "the caller's read-write or admin role in it subscribes them. An issue is the GitHub " +
          'issue linked to a task.',
        response: {
          200: {
            type: 'object',
            required: ['projects', 'issues'],
            properties: {
              projects: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['projectId', 'name', 'automatic'],
                  properties: {
                    projectId: uuid,
                    name: { type: 'string' },
                    automatic: { type: 'boolean' },
                  },
                },
              },
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['taskId', 'projectId', 'repository', 'number'],
                  properties: {
                    taskId: uuid,
                    projectId: uuid,
                    repository: {
                      type: 'object',
                      required: ['id', 'owner', 'name'],
                      properties: { id: uuid, owner: { type: 'string' }, name: { type: 'string' } },
                    },
                    number: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => services.notifications.subscriptionsOf(callerOf(request)),
  )

  group.put<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    {
      schema: {
        description:
          'Subscribes the caller to the project, for anyone with a role in it. Subscribing again ' +
          'changes nothing.',
        params: projectParams,
        body: noBody,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.notifications.subscribeToProject(callerOf(request), request.params.projectId)
      return reply.code(204).send()
    },
  )

  group.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    {
      schema: {
        description:
          "Ends the caller's subscription to the project. Refused with 409 while their " +
          'read-write or admin role subscribes them, and with 404 if they are not subscribed.',
        params: projectParams,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.notifications.unsubscribeFromProject(
        callerOf(request),
        request.params.projectId,
      )
      return reply.code(204).send()
    },
  )

  group.put<{ Params: { taskId: string } }>(
    '/issues/:taskId',
    {
      schema: {
        description:
          "Subscribes the caller to the GitHub issue linked to the task, for anyone with a role in the task's " +
          'project. Refused with 404 if the task has no issue. Subscribing again changes nothing.',
        params: taskParams,
        body: noBody,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.notifications.subscribeToIssue(callerOf(request), request.params.taskId)
      return reply.code(204).send()
    },
  )

  group.delete<{ Params: { taskId: string } }>(
    '/issues/:taskId',
    {
      schema: {
        description:
          "Ends the caller's subscription to the task's GitHub issue. Refused with 404 if they " +
          'are not subscribed.',
        params: taskParams,
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await services.notifications.unsubscribeFromIssue(callerOf(request), request.params.taskId)
      return reply.code(204).send()
    },
  )
}
