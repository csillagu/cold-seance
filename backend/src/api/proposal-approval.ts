import type { FastifyPluginAsync } from 'fastify'
import type { ApprovalInput } from '../service/proposal-approval.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'
import { preview, previewBody } from './proposal-preview.ts'
import { proposal, proposalParams } from './proposals.ts'

const approvalResult = {
  type: 'object',
  required: ['outcome', 'proposal', 'preview'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['confirm-again', 'waiting-for-parts', 'applied'],
      description:
        '`confirm-again`: the plan is not at the version named, or none was named, so nothing ' +
        'was approved; confirm with the `planVersion` of `preview`. `waiting-for-parts`: the ' +
        "part was approved, and other projects' parts still wait for approval. `applied`: " +
        'every part is approved, and all the changes were applied',
    },
    proposal: { ...proposal, description: 'The proposal as it is after the approval' },
    preview: {
      ...preview,
      type: ['object', 'null'],
      description: 'For `confirm-again`, the preview against the plan as it is now; else null',
    },
  },
} as const

/**
 * The route that approves a project's part of a proposal (SC-048, SC-026). It only translates the
 * request; the proposal approval decides what is allowed and what is applied (DD-039).
 */
export const proposalApprovalRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.post<{ Params: { proposalId: string }; Body: ApprovalInput }>(
    '/:proposalId/approval',
    {
      schema: {
        description:
          'Approves the part of the proposal that changes the project `projectId`, against the ' +
          'plan version `planVersion` of the preview the reviewer saw. If the plan is no longer ' +
          'at that version, or none is given, nothing is approved and a new preview is sent to ' +
          'confirm. Once every project it changes has approved its part, all of its changes are ' +
          'applied together, each as made by the approver of its part, or none of them: a ' +
          'change that cannot be made is refused with 409, naming it. Only the read-write ' +
          'members and admins of the project can approve its part, and only while the proposal ' +
          'waits for review: an approved, rejected or expired proposal is refused with 409.',
        params: proposalParams,
        // No types inside, so that Fastify does not coerce a value: the service layer alone
        // decides what an approval is, the same for every channel (DD-039).
        body: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: { description: 'The project whose part is approved, by id' },
            planVersion: { description: "The `planVersion` of the reviewer's preview" },
          },
          additionalProperties: false,
        },
        response: { 200: approvalResult },
      },
    },
    async (request) => {
      const result = await services.proposalApproval.approve(
        callerOf(request),
        request.params.proposalId,
        request.body,
      )
      return {
        outcome: result.outcome,
        proposal: result.proposal,
        preview: result.outcome === 'confirm-again' ? previewBody(result.preview) : null,
      }
    },
  )
}
