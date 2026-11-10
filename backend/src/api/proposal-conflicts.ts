import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const conflicts = {
  type: 'object',
  required: ['proposalId', 'conflicts'],
  properties: {
    proposalId: { type: 'string', format: 'uuid' },
    conflicts: {
      type: 'array',
      description:
        'Each change of the proposal that conflicts with the live plan, for the reviewer to ' +
        'resolve or drop, in the order of its groups and of the changes in each',
      items: {
        type: 'object',
        required: ['groupId', 'changeId', 'taskId', 'reason', 'inputs'],
        properties: {
          groupId: {
            type: 'string',
            format: 'uuid',
            description: 'The group the change is in, which is edited or dropped as one',
          },
          changeId: { type: 'string', format: 'uuid' },
          taskId: { type: 'string', format: 'uuid', description: 'The task the change changes' },
          reason: {
            type: 'string',
            enum: ['edited', 'deleted'],
            description:
              'edited: someone other than its creator edited an input the change changes on ' +
              'its task after the change was given; deleted: its task was deleted',
          },
          inputs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The inputs of the change that were edited, as the change names them: a task ' +
              'field it gives, or parent, blocker, status or repository; empty for a deleted task',
          },
        },
      },
    },
  },
} as const

/**
 * The route of a proposal's conflicts (SC-047, SC-026). It only translates the request; the
 * proposal conflict detector decides what conflicts (DD-039).
 */
export const proposalConflictRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { proposalId: string } }>(
    '/:proposalId/conflicts',
    {
      schema: {
        description:
          "The proposal's conflicts: each change whose input on the same task someone else " +
          'edited after the change was given, or whose task was deleted. An edit of another ' +
          'input of the task, or the rescheduling of its dates, is no conflict. Nothing is changed.',
        params: {
          type: 'object',
          required: ['proposalId'],
          properties: { proposalId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: conflicts },
      },
    },
    async (request) =>
      services.proposalConflicts.conflictsOf(callerOf(request), request.params.proposalId),
  )
}
