import type { FastifyPluginAsync } from 'fastify'
import { SAVED_VIEW_KINDS } from '../db/schema.ts'
import { FILTER_FIELDS, FILTER_OPERATORS } from '../service/saved-view-filter.ts'
import { SAVED_VIEW_PLACES, type SavedViewInput } from '../service/saved-views.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'
import { task } from './tasks.ts'

const id = { type: 'string', format: 'uuid' } as const

const nullableId = { type: ['string', 'null'], format: 'uuid' } as const

const filterDescription =
  'The conditions a task must all meet to be shown; an empty list shows every task. Each names ' +
  `a task \`field\` (${FILTER_FIELDS.join(', ')}), an \`operator\` ` +
  `(${FILTER_OPERATORS.join(', ')}) and a \`value\`: text for title and description; a status; ` +
  'a date, `YYYY-MM-DD`, for the planned and actual dates; a number for the duration in working ' +
  'days, the effort and the AI share; a milestone variant; an id for the project and the ' +
  'repository; an issue number for githubIssue; and, for eligibility and assignees, which take ' +
  'only `contains`, a person: `{ "accountId": <id> }`, or `{ "viewer": true }` for whoever ' +
  'opens the view. `is` and `is-not` with `null` ask whether a field that can be empty is.'

const condition = {
  type: 'object',
  required: ['field', 'operator', 'value'],
  properties: {
    field: { type: 'string', enum: FILTER_FIELDS },
    operator: { type: 'string', enum: FILTER_OPERATORS },
    value: {},
  },
} as const

/** A saved view as the routes send it (FR-054, FR-055, FR-056, FR-057). */
const savedView = {
  type: 'object',
  required: [
    'id',
    'name',
    'kind',
    'keptIn',
    'projectId',
    'groupId',
    'ownerId',
    'projects',
    'filter',
  ],
  properties: {
    id,
    name: { type: 'string' },
    kind: { type: 'string', enum: [...SAVED_VIEW_KINDS] },
    keptIn: { type: 'string', enum: [...SAVED_VIEW_PLACES] },
    projectId: nullableId,
    groupId: nullableId,
    ownerId: nullableId,
    projects: {
      type: 'array',
      items: id,
      description: 'The projects it covers, by name, among only those the caller can read',
    },
    filter: { type: 'array', items: condition, description: filterDescription },
  },
} as const

const views = { type: 'array', items: savedView } as const

/**
 * The routes of saved views (SC-020, SC-026): save a view, list every view the caller sees, read
 * one, and open it. They only translate the request; the saved view service decides what is
 * allowed (DD-039).
 */
export const savedViewRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get(
    '/',
    {
      schema: {
        description:
          'Every saved view the caller sees: those kept in the projects they can read, in the ' +
          'groups they are a member of, and personally by them.',
        response: { 200: views },
      },
    },
    async (request) => services.savedViews.listViews(callerOf(request)),
  )

  routes.post<{ Body: SavedViewInput }>(
    '/',
    {
      schema: {
        description:
          'Saves a named Kanban or Gantt view, kept in a project (by its read-write members and ' +
          'admins), a group (by its read-write members and admins) or personally. A view kept in ' +
          "a project covers that project only, one kept in a group some of the group's " +
          'projects, and a personal one some of the projects its owner can read.',
        body: {
          type: 'object',
          required: ['name', 'kind', 'keptIn'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: [...SAVED_VIEW_KINDS] },
            keptIn: { type: 'string', enum: [...SAVED_VIEW_PLACES] },
            projectId: { ...id, description: 'For a view kept in a project: the project' },
            groupId: { ...id, description: 'For a view kept in a group: the group' },
            projects: {
              type: 'array',
              items: id,
              description:
                'The projects it covers; for a view kept in a project, it may be left out',
            },
            filter: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'operator', 'value'],
                properties: { field: { type: 'string' }, operator: { type: 'string' }, value: {} },
                additionalProperties: false,
              },
              description: filterDescription,
            },
          },
          additionalProperties: false,
        },
        response: { 201: savedView },
      },
    },
    async (request, reply) => {
      const saved = await services.savedViews.saveView(callerOf(request), request.body)
      return reply.code(201).send(saved)
    },
  )

  const viewParams = { type: 'object', required: ['viewId'], properties: { viewId: id } } as const

  routes.get<{ Params: { viewId: string } }>(
    '/:viewId',
    { schema: { params: viewParams, response: { 200: savedView } } },
    async (request) => services.savedViews.getView(callerOf(request), request.params.viewId),
  )

  routes.get<{ Params: { viewId: string } }>(
    '/:viewId/tasks',
    {
      schema: {
        description:
          'Opens the view: the tasks of the projects it covers that meet its filter, with the ' +
          'caller as the person viewing it, among only those the caller can read now.',
        params: viewParams,
        response: { 200: { type: 'array', items: task } },
      },
    },
    async (request) => services.savedViews.openView(callerOf(request), request.params.viewId),
  )
}

/** The saved views kept in one project (SC-020, SC-026). */
export const projectSavedViewRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { projectId: string } }>(
    '/:projectId/saved-views',
    {
      schema: {
        description: 'The views kept in the project, for anyone who can read it.',
        params: { type: 'object', required: ['projectId'], properties: { projectId: id } },
        response: { 200: views },
      },
    },
    async (request) =>
      services.savedViews.listProjectViews(callerOf(request), request.params.projectId),
  )
}

/** The saved views kept in one group (SC-020, SC-026). */
export const groupSavedViewRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  routes,
  { services },
) => {
  routes.get<{ Params: { groupId: string } }>(
    '/:groupId/saved-views',
    {
      schema: {
        description: "The views kept in the group, for the group's members.",
        params: { type: 'object', required: ['groupId'], properties: { groupId: id } },
        response: { 200: views },
      },
    },
    async (request) =>
      services.savedViews.listGroupViews(callerOf(request), request.params.groupId),
  )
}
