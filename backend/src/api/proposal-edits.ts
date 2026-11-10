import type { FastifyPluginAsync } from 'fastify'
import type { GroupInput } from '../service/proposal-edits.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'
import { proposal, proposalParams } from './proposals.ts'

const groupParams = {
  type: 'object',
  required: ['proposalId', 'groupId'],
  properties: {
    proposalId: { type: 'string', format: 'uuid' },
    groupId: { type: 'string', format: 'uuid' },
  },
} as const

type GroupParams = { proposalId: string; groupId: string }

const REFUSALS =
  'Only the read-write members and admins of each project concerned can do it, and only while ' +
  'the proposal waits for review: a rejected or expired proposal is refused with 409.'

/**
 * The routes that edit a proposal one group at a time, and reject it (SC-045, SC-026). They only
 * translate the request; the service layer decides what is allowed (DD-039).
 */
export const proposalEditRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.put<{ Params: GroupParams; Body: GroupInput }>(
    '/:proposalId/groups/:groupId',
    {
      schema: {
        description:
          "Replaces the group's changes, as one: `changes` is the group's whole new list of " +
          'changes, each as when the proposal is created. It changes nothing in the plan, and ' +
          `starts the proposal's 24 hours again. ${REFUSALS}`,
        params: groupParams,
        // No types inside, so that Fastify does not coerce a value: the service layer alone
        // decides what a change is, the same for every channel (DD-039).
        body: {
          type: 'object',
          required: ['changes'],
          properties: {
            changes: { description: "The group's changes: `[<change>, ...]`" },
          },
          additionalProperties: false,
        },
        response: { 200: proposal },
      },
    },
    async (request) =>
      services.proposalEdits.editGroup(
        callerOf(request),
        request.params.proposalId,
        request.params.groupId,
        request.body,
      ),
  )

  group.delete<{ Params: GroupParams }>(
    '/:proposalId/groups/:groupId',
    {
      schema: {
        description:
          "Drops the group, every change in it as one, and starts the proposal's 24 hours " +
          `again. The proposal's only group cannot be dropped: reject the proposal instead. ${REFUSALS}`,
        params: groupParams,
        response: { 200: proposal },
      },
    },
    async (request) =>
      services.proposalEdits.dropGroup(
        callerOf(request),
        request.params.proposalId,
        request.params.groupId,
      ),
  )

  group.post<{ Params: { proposalId: string } }>(
    '/:proposalId/rejection',
    {
      schema: {
        description:
          'Rejects the proposal: it no longer waits for review, and nothing in it can be ' +
          `approved. ${REFUSALS}`,
        params: proposalParams,
        // Nothing to send: the body may be left out, or be an empty object.
        body: { type: ['object', 'null'], properties: {}, additionalProperties: false },
        response: { 200: proposal },
      },
    },
    async (request) =>
      services.proposalEdits.rejectProposal(callerOf(request), request.params.proposalId),
  )
}
