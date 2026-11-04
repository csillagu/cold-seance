import type { FastifyPluginAsync } from 'fastify'
import { WEEKDAYS } from '../service/calendars.ts'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

const day = { type: 'string', format: 'date' } as const

const globalCalendar = {
  type: 'object',
  required: ['weekendDays', 'holidays'],
  properties: {
    weekendDays: {
      type: 'array',
      items: { type: 'string', enum: [...WEEKDAYS] },
      description: 'The days of the week that are the weekend, Monday first',
    },
    holidays: { type: 'array', items: day, description: 'The company holidays, earliest first' },
  },
} as const

const personalCalendar = {
  type: 'object',
  required: ['accountId', 'holidays'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    holidays: { type: 'array', items: day, description: "The person's holidays, earliest first" },
  },
} as const

const capacity = {
  type: 'object',
  required: ['accountId', 'capacity'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    capacity: { type: 'integer', description: 'The capacity, in percent of full time' },
  },
} as const

const absence = {
  type: 'object',
  required: ['id', 'accountId', 'from', 'to'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    from: { ...day, description: 'The first whole day of the absence' },
    to: { ...day, description: 'The last whole day of the absence, included' },
  },
} as const

// The request fields carry no type, and the bodies take fields they do not list, so that Fastify
// neither coerces a value nor drops a field: the calendar service alone decides what a change may
// hold, and refuses what it may not, the same through every channel (DD-039).
const holidayChanges = {
  addHolidays: { description: 'Holidays to add: a list of dates, YYYY-MM-DD' },
  removeHolidays: { description: 'Holidays to remove: a list of dates, YYYY-MM-DD' },
} as const

const accountParams = {
  type: 'object',
  required: ['accountId'],
  properties: { accountId: { type: 'string', format: 'uuid' } },
} as const

const absenceParams = {
  type: 'object',
  required: ['accountId', 'absenceId'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    absenceId: { type: 'string', format: 'uuid' },
  },
} as const

/**
 * The routes of the global calendar (SC-008, SC-026): read it, and change its weekend days and
 * company holidays. They only translate the request; the calendar service decides what is allowed
 * (DD-039).
 */
export const globalCalendarRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get('/', { schema: { response: { 200: globalCalendar } } }, async (request) =>
    services.calendars.globalCalendar(callerOf(request)),
  )

  group.patch<{ Body: unknown }>(
    '/',
    {
      schema: {
        description:
          'Changes the global calendar, all at once or not at all. Only system admins may.',
        body: {
          type: 'object',
          properties: {
            weekendDays: {
              description: `The days of the week that are to be the weekend, from ${WEEKDAYS.join(', ')}; not all seven`,
            },
            ...holidayChanges,
          },
        },
        response: { 200: globalCalendar },
      },
    },
    async (request) => services.calendars.changeGlobalCalendar(callerOf(request), request.body),
  )
}

/**
 * The routes of a person's availability (SC-008, SC-026): their own calendar of holidays, their
 * capacity and their absences, each read and changed by the person or a system admin. They only
 * translate the request; the calendar service decides what is allowed (DD-039).
 */
export const availabilityRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { accountId: string } }>(
    '/:accountId/calendar',
    { schema: { params: accountParams, response: { 200: personalCalendar } } },
    async (request) =>
      services.calendars.personalCalendarOf(callerOf(request), request.params.accountId),
  )

  group.patch<{ Params: { accountId: string }; Body: unknown }>(
    '/:accountId/calendar',
    {
      schema: {
        description:
          "Adds and removes holidays in a person's own calendar, all at once or not at all. It " +
          'has no weekend of its own; the weekend is set in the global calendar.',
        params: accountParams,
        body: { type: 'object', properties: holidayChanges },
        response: { 200: personalCalendar },
      },
    },
    async (request) =>
      services.calendars.changePersonalCalendar(
        callerOf(request),
        request.params.accountId,
        request.body,
      ),
  )

  group.get<{ Params: { accountId: string } }>(
    '/:accountId/capacity',
    { schema: { params: accountParams, response: { 200: capacity } } },
    async (request) => services.calendars.capacityOf(callerOf(request), request.params.accountId),
  )

  group.put<{ Params: { accountId: string }; Body: { capacity?: unknown } }>(
    '/:accountId/capacity',
    {
      schema: {
        params: accountParams,
        body: {
          type: 'object',
          required: ['capacity'],
          properties: {
            capacity: { description: 'The capacity: a whole percentage of full time, 0 to 100' },
          },
        },
        response: { 200: capacity },
      },
    },
    async (request) =>
      services.calendars.setCapacity(
        callerOf(request),
        request.params.accountId,
        request.body.capacity,
      ),
  )

  group.get<{ Params: { accountId: string } }>(
    '/:accountId/absences',
    { schema: { params: accountParams, response: { 200: { type: 'array', items: absence } } } },
    async (request) => services.calendars.absencesOf(callerOf(request), request.params.accountId),
  )

  group.post<{ Params: { accountId: string }; Body: unknown }>(
    '/:accountId/absences',
    {
      schema: {
        description: 'Records an absence, such as vacation or sick leave, in whole days.',
        params: accountParams,
        body: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { description: 'The first whole day of the absence, YYYY-MM-DD' },
            to: { description: 'The last whole day of the absence, included, YYYY-MM-DD' },
          },
        },
        response: { 201: absence },
      },
    },
    async (request, reply) => {
      const created = await services.calendars.recordAbsence(
        callerOf(request),
        request.params.accountId,
        request.body,
      )
      return reply.code(201).send(created)
    },
  )

  group.delete<{ Params: { accountId: string; absenceId: string } }>(
    '/:accountId/absences/:absenceId',
    { schema: { params: absenceParams, response: { 204: { type: 'null' } } } },
    async (request, reply) => {
      await services.calendars.removeAbsence(
        callerOf(request),
        request.params.accountId,
        request.params.absenceId,
      )
      return reply.code(204).send()
    },
  )
}
