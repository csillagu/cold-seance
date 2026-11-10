import type { FastifyPluginAsync } from 'fastify'
import type { ProposalPreview } from '../service/proposal-preview.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'
import { redFlag } from './red-flags.ts'
import { task } from './tasks.ts'

/** A task as the preview sends it: the task, with its parent and its blockers. */
const previewedTask = {
  ...task,
  required: [...task.required, 'parentId', 'blockedBy'],
  properties: {
    ...task.properties,
    parentId: {
      type: ['string', 'null'],
      format: 'uuid',
      description: 'The task it is a subtask of, by id; null for none',
    },
    blockedBy: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      description: 'The tasks it is blocked by, by id, in the order of their ids',
    },
  },
} as const

const { id: _id, raisedAt: _raisedAt, ...newRedFlagProperties } = redFlag.properties

/** A red flag the proposal would raise: as the red flag register gives it, not yet raised. */
const newRedFlag = {
  ...redFlag,
  required: ['kind', 'projectId'],
  properties: newRedFlagProperties,
} as const

export const preview = {
  type: 'object',
  required: ['proposalId', 'planVersion', 'differences', 'newRedFlags'],
  properties: {
    proposalId: { type: 'string', format: 'uuid' },
    planVersion: {
      type: 'string',
      description:
        'The version of the plan the preview was made against, which an approval of the ' +
        'proposal names',
    },
    differences: {
      type: 'array',
      description:
        'Each task of the projects the proposal changes that its changes, or the rescheduling ' +
        'they cause, would change, in the order the tasks were created',
      items: {
        type: 'object',
        required: ['taskId', 'projectId', 'newTask', 'before', 'after'],
        properties: {
          taskId: {
            type: 'string',
            format: 'uuid',
            description:
              'The task. A task the proposal creates has an id within this preview only, which ' +
              'names it in the other tasks and red flags of the preview and nowhere else',
          },
          projectId: { type: 'string', format: 'uuid' },
          newTask: {
            type: ['string', 'null'],
            description: 'The key the proposal gives a task it creates; null for an existing task',
          },
          before: {
            ...previewedTask,
            type: ['object', 'null'],
            description: 'The task in the live plan; null for a task the proposal creates',
          },
          after: { ...previewedTask, description: 'The task once the proposal is applied' },
        },
      },
    },
    newRedFlags: {
      type: 'array',
      items: newRedFlag,
      description:
        'Each red flag the proposal would raise in a project it changes that is not raised ' +
        'there now; one across a project boundary only if the caller can read both projects',
    },
  },
} as const

/**
 * The route of a proposal's live preview (SC-011, SC-026). It only translates the request; the
 * proposal preview decides what is shown (DD-039).
 */
export const proposalPreviewRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { proposalId: string } }>(
    '/:proposalId/preview',
    {
      schema: {
        description:
          "The proposal's live preview against the current plan: its changes made on a copy of " +
          'the plan as it is now and rescheduled, with the tasks that would change and the new ' +
          'red flags. Nothing is saved, and the proposal is left as it is. Refused with 409 if ' +
          'one of its changes cannot be made on the plan as it is now, naming the change.',
        params: {
          type: 'object',
          required: ['proposalId'],
          properties: { proposalId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: preview },
      },
    },
    async (request) =>
      previewBody(
        await services.proposalPreview.previewProposal(
          callerOf(request),
          request.params.proposalId,
        ),
      ),
  )
}

/** The preview as the routes send it: each new red flag with its detail spread out. */
export function previewBody(result: ProposalPreview) {
  return {
    proposalId: result.proposalId,
    planVersion: result.planVersion,
    differences: result.differences,
    newRedFlags: result.newRedFlags.map(({ kind, projectId, detail }) => ({
      kind,
      projectId,
      ...detail,
    })),
  }
}
