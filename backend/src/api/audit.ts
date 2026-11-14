import type { FastifyPluginAsync } from 'fastify'
import { MAX_PAGE_SIZE } from '../service/audit.ts'
import { CHANNELS } from '../service/caller.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const entry = {
  type: 'object',
  required: ['id', 'at', 'by', 'channels', 'projectId', 'action', 'subject', 'details'],
  properties: {
    id: { type: 'integer' },
    at: { type: 'string', format: 'date-time' },
    by: {
      description:
        'Who made the change: an account, or for a change made on GitHub, the GitHub login of whoever made it there.',
      oneOf: [
        {
          type: 'object',
          required: ['accountId', 'username'],
          properties: {
            accountId: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['githubLogin'],
          properties: { githubLogin: { type: 'string' } },
          additionalProperties: false,
        },
      ],
    },
    channels: {
      type: 'array',
      items: { type: 'string', enum: [...CHANNELS] },
      description:
        "The channels the change came through: one, or for a change an approved AI proposal applied, the proposal's channel and then the approval's.",
    },
    projectId: { type: ['string', 'null'], format: 'uuid' },
    action: { type: 'string' },
    subject: {
      type: 'object',
      required: ['type', 'id'],
      properties: { type: { type: 'string' }, id: { type: 'string' } },
    },
    details: { type: 'object', additionalProperties: true },
  },
} as const

interface AuditLogQuery {
  projectId?: string
  limit?: number
  before?: number
}

/**
 * The route of the audit log (SC-013, SC-026): read the whole log, or one project's part of it,
 * newest entry first, a page at a time. It only translates the request; the audit log service
 * decides who may read what (DD-039).
 */
export const auditLogRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Querystring: AuditLogQuery }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            before: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          },
          additionalProperties: false,
        },
        response: { 200: { type: 'array', items: entry } },
      },
    },
    async (request) => services.audit.readLog(callerOf(request), request.query),
  )
}
