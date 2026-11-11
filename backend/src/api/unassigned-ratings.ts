import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const person = { type: 'string', format: 'uuid' } as const

const andOr = (operand: object) =>
  [
    {
      type: 'object',
      required: ['all'],
      properties: { all: { type: 'array', minItems: 1, items: operand } },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['any'],
      properties: { any: { type: 'array', minItems: 1, items: operand } },
      additionalProperties: false,
    },
  ] as const

const rating = {
  type: 'object',
  required: ['taskId', 'title', 'plannedStart', 'plannedFinish', 'eligibility', 'rating'],
  properties: {
    taskId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    plannedStart: { type: 'string', format: 'date' },
    plannedFinish: { type: 'string', format: 'date' },
    eligibility: {
      description:
        'Who can do the task: a person, by account id, or an AND ({"all": [...]}) or OR ' +
        '({"any": [...]}) of people and of ANDs and ORs of people',
      anyOf: [person, ...andOr({ anyOf: [person, ...andOr(person)] })],
    },
    rating: {
      type: 'string',
      enum: ['red', 'amber', 'green'],
      description:
        'Red when every valid combination of eligible people overloads someone, amber when ' +
        'some do and others do not, green when none does',
    },
  },
} as const

/**
 * The route of a project's eligible but unassigned tasks, each rated by load (SC-041, SC-026). It
 * only translates the request; the unassigned task load rating rates them and decides who may
 * read them (DD-039).
 */
export const unassignedRatingRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/unassigned-task-ratings',
    {
      schema: {
        description:
          "The project's tasks that have an eligibility expression but no assigned people, are " +
          'not cancelled and have planned dates, in the order they were created, each rated ' +
          'red, amber or green by whether the valid combinations of its eligible people would ' +
          'overload someone over its planned days. Computed now and not stored.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: rating } },
      },
    },
    async (request) =>
      services.unassignedRatings.ratingsOf(callerOf(request), request.params.projectId),
  )
}
