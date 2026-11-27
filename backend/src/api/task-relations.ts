import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const taskRef = {
  type: 'object',
  required: ['id', 'projectId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid', description: 'The project that owns the task' },
  },
} as const

/** A task's relations as the routes send them (SC-002). */
export const relations = {
  type: 'object',
  required: ['taskId', 'parent', 'subtasks', 'blockedBy'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    parent: {
      ...taskRef,
      type: ['object', 'null'],
      description: 'The task this one is a subtask of; null when it is a subtask of none',
    },
    subtasks: {
      type: 'array',
      items: taskRef,
      description: 'Its subtasks, in the order they were created',
    },
    blockedBy: {
      type: 'array',
      items: taskRef,
      description:
        "What it is blocked by: tasks of its own project, or milestones of other projects. The relations are held in this task's project.",
    },
  },
} as const

const taskParams = {
  type: 'object',
  required: ['taskId'],
  properties: { taskId: { type: 'string', format: 'uuid' } },
} as const

const blockerParams = {
  type: 'object',
  required: ['taskId', 'blockerId'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    blockerId: { type: 'string', format: 'uuid' },
  },
} as const

const reply = { 200: relations } as const

/**
 * The routes of a task's relations (SC-002, SC-026): read its parent, subtasks and blockers; set
 * its parent; make it blocked by a task, or a milestone of another project, and no longer. They
 * only translate the request; the task relation service decides what is allowed (DD-039).
 */
export const taskRelationRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { taskId: string } }>(
    '/:taskId/relations',
    { schema: { params: taskParams, response: reply } },
    async (request) =>
      services.taskRelations.getRelations(callerOf(request), request.params.taskId),
  )

  group.put<{ Params: { taskId: string }; Body: { parentId: string | null } }>(
    '/:taskId/parent',
    {
      schema: {
        params: taskParams,
        body: {
          type: 'object',
          required: ['parentId'],
          properties: {
            parentId: {
              type: ['string', 'null'],
              description:
                'The task to make this one a subtask of; null to make it a subtask of none',
            },
          },
          additionalProperties: false,
        },
        response: reply,
      },
    },
    async (request) =>
      services.taskRelations.setParent(
        callerOf(request),
        request.params.taskId,
        request.body.parentId,
      ),
  )

  group.post<{ Params: { taskId: string }; Body: { blockerId: string } }>(
    '/:taskId/blocked-by',
    {
      schema: {
        params: taskParams,
        body: {
          type: 'object',
          required: ['blockerId'],
          properties: {
            blockerId: {
              type: 'string',
              description:
                "The task to make this one blocked by: a task of its project, or another project's milestone",
            },
          },
          additionalProperties: false,
        },
        response: reply,
      },
    },
    async (request) =>
      services.taskRelations.addBlocker(
        callerOf(request),
        request.params.taskId,
        request.body.blockerId,
      ),
  )

  group.delete<{ Params: { taskId: string; blockerId: string } }>(
    '/:taskId/blocked-by/:blockerId',
    { schema: { params: blockerParams, response: reply } },
    async (request) =>
      services.taskRelations.removeBlocker(
        callerOf(request),
        request.params.taskId,
        request.params.blockerId,
      ),
  )
}

/**
 * The relations of every task of a project, in one request (SC-026), for the views that draw them
 * all: a project's Gantt and its variance view. They are answered as each task's own relations
 * are; the task relation service decides what is allowed (DD-039).
 */
export const projectTaskRelationRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/task-relations',
    {
      schema: {
        description:
          'The relations of every task of the project, in the order the tasks were created, each as GET /tasks/{taskId}/relations answers it, for anyone with a role in the project.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: relations } },
      },
    },
    async (request) =>
      services.taskRelations.listRelations(callerOf(request), request.params.projectId),
  )
}
