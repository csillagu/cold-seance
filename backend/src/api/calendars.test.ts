import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The calendar routes translate requests for the calendar service and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/calendars.test.ts. Here
// the service is a stub, so these tests show what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const ABSENCE_ID = '6f1c2a5e-0000-4000-8000-0000000000a1'
const GLOBAL = { weekendDays: ['saturday', 'sunday'] as const, holidays: ['2027-03-03'] }
const PERSONAL = { accountId: ERIN, holidays: ['2027-03-15'] }
const CAPACITY = { accountId: ERIN, capacity: 80 }
const ABSENCE = { id: ABSENCE_ID, accountId: ERIN, from: '2027-03-08', to: '2027-03-12' }

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin' ? { accountId: ERIN, channel: 'ui' } : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'ui' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const calendars = {
    globalCalendar: vi.spyOn(services.calendars, 'globalCalendar'),
    changeGlobalCalendar: vi.spyOn(services.calendars, 'changeGlobalCalendar'),
    personalCalendarOf: vi.spyOn(services.calendars, 'personalCalendarOf'),
    changePersonalCalendar: vi.spyOn(services.calendars, 'changePersonalCalendar'),
    capacityOf: vi.spyOn(services.calendars, 'capacityOf'),
    setCapacity: vi.spyOn(services.calendars, 'setCapacity'),
    absencesOf: vi.spyOn(services.calendars, 'absencesOf'),
    recordAbsence: vi.spyOn(services.calendars, 'recordAbsence'),
    removeAbsence: vi.spyOn(services.calendars, 'removeAbsence'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, calendars }
}

describe('GET /api/calendar', () => {
  it('sends the global calendar the service reads for the caller', async () => {
    const { app, calendars } = stubbed()
    calendars.globalCalendar.mockResolvedValue({ ...GLOBAL, weekendDays: [...GLOBAL.weekendDays] })
    const response = await app.inject({ method: 'GET', url: '/api/calendar', headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(GLOBAL)
    expect(calendars.globalCalendar).toHaveBeenCalledWith(caller)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, calendars } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/calendar' })
    expect(response.statusCode).toBe(401)
    expect(calendars.globalCalendar).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/calendar', () => {
  it('hands the service the whole change, untouched, and sends the calendar', async () => {
    const { app, calendars } = stubbed()
    calendars.changeGlobalCalendar.mockResolvedValue({
      ...GLOBAL,
      weekendDays: [...GLOBAL.weekendDays],
    })
    // A lone date is not coerced into a list, and a field the route does not list is kept, so
    // that the service alone decides what a change may hold.
    const payload = { weekendDays: 'friday', addHolidays: '2027-03-03', hours: 4 }
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/calendar',
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(GLOBAL)
    expect(calendars.changeGlobalCalendar).toHaveBeenCalledWith(caller, payload)
  })

  it.each([
    ['forbidden', 403, 'Only system admins can change the company holidays and the weekend days'],
    ['invalid', 400, 'The weekend cannot be every day of the week'],
  ] as const)('answers a %s refusal with %i and its message', async (kind, statusCode, message) => {
    const { app, calendars } = stubbed()
    calendars.changeGlobalCalendar.mockRejectedValue(new ServiceError(kind, message))
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/calendar',
      headers: erin,
      payload: { addHolidays: ['2027-03-03'] },
    })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(message)
  })

  it('refuses a body that is not an object before the service is asked', async () => {
    const { app, calendars } = stubbed()
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/calendar',
      headers: { ...erin, 'content-type': 'application/json' },
      payload: '["2027-03-03"]',
    })
    expect(response.statusCode).toBe(400)
    expect(calendars.changeGlobalCalendar).not.toHaveBeenCalled()
  })
})

describe("a person's own calendar", () => {
  it('GET hands the service the caller and the account and sends the calendar', async () => {
    const { app, calendars } = stubbed()
    calendars.personalCalendarOf.mockResolvedValue(PERSONAL)
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN}/calendar`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PERSONAL)
    expect(calendars.personalCalendarOf).toHaveBeenCalledWith(caller, ERIN)
  })

  it('PATCH hands the service the whole change, a weekend included, and sends the calendar', async () => {
    const { app, calendars } = stubbed()
    calendars.changePersonalCalendar.mockResolvedValue(PERSONAL)
    const payload = { addHolidays: ['2027-03-15'], weekendDays: ['friday'] }
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${ERIN}/calendar`,
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PERSONAL)
    expect(calendars.changePersonalCalendar).toHaveBeenCalledWith(caller, ERIN, payload)
  })

  it('refuses an account id that is not a UUID before the service is asked', async () => {
    const { app, calendars } = stubbed()
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/accounts/erin/calendar',
      headers: erin,
      payload: { addHolidays: ['2027-03-15'] },
    })
    expect(response.statusCode).toBe(400)
    expect(calendars.changePersonalCalendar).not.toHaveBeenCalled()
  })
})

describe("a person's capacity", () => {
  it('GET sends the capacity the service reads', async () => {
    const { app, calendars } = stubbed()
    calendars.capacityOf.mockResolvedValue(CAPACITY)
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN}/capacity`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CAPACITY)
    expect(calendars.capacityOf).toHaveBeenCalledWith(caller, ERIN)
  })

  it('PUT hands the service the capacity as sent, without coercing it', async () => {
    const { app, calendars } = stubbed()
    calendars.setCapacity.mockRejectedValue(
      new ServiceError('invalid', 'A capacity is a whole percentage from 0 to 100'),
    )
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN}/capacity`,
      headers: erin,
      payload: { capacity: '80' },
    })
    expect(response.statusCode).toBe(400)
    expect(calendars.setCapacity).toHaveBeenCalledWith(caller, ERIN, '80')
  })

  it('PUT sends the capacity the service sets', async () => {
    const { app, calendars } = stubbed()
    calendars.setCapacity.mockResolvedValue(CAPACITY)
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN}/capacity`,
      headers: erin,
      payload: { capacity: 80 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CAPACITY)
    expect(calendars.setCapacity).toHaveBeenCalledWith(caller, ERIN, 80)
  })

  it('PUT refuses a body without a capacity before the service is asked', async () => {
    const { app, calendars } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN}/capacity`,
      headers: erin,
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(calendars.setCapacity).not.toHaveBeenCalled()
  })
})

describe("a person's absences", () => {
  it('GET sends the absences the service lists', async () => {
    const { app, calendars } = stubbed()
    calendars.absencesOf.mockResolvedValue([ABSENCE])
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN}/absences`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([ABSENCE])
    expect(calendars.absencesOf).toHaveBeenCalledWith(caller, ERIN)
  })

  it('POST hands the service the absence as sent and sends it as 201', async () => {
    const { app, calendars } = stubbed()
    calendars.recordAbsence.mockResolvedValue(ABSENCE)
    const payload = { from: '2027-03-08', to: '2027-03-12' }
    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${ERIN}/absences`,
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(ABSENCE)
    expect(calendars.recordAbsence).toHaveBeenCalledWith(caller, ERIN, payload)
  })

  it('POST refuses an absence without its last day before the service is asked', async () => {
    const { app, calendars } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${ERIN}/absences`,
      headers: erin,
      payload: { from: '2027-03-08' },
    })
    expect(response.statusCode).toBe(400)
    expect(calendars.recordAbsence).not.toHaveBeenCalled()
  })

  it('DELETE hands the service the absence and answers 204', async () => {
    const { app, calendars } = stubbed()
    calendars.removeAbsence.mockResolvedValue()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${ERIN}/absences/${ABSENCE_ID}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(calendars.removeAbsence).toHaveBeenCalledWith(caller, ERIN, ABSENCE_ID)
  })

  it('DELETE answers a not-found refusal with 404', async () => {
    const { app, calendars } = stubbed()
    calendars.removeAbsence.mockRejectedValue(
      new ServiceError('not-found', 'There is no such absence'),
    )
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${ERIN}/absences/${ABSENCE_ID}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('There is no such absence')
  })
})

describe('the OpenAPI description', () => {
  it('describes every calendar route', async () => {
    const { app } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    const paths = response.json().paths
    expect(Object.keys(paths['/api/calendar/'] ?? paths['/api/calendar'])).toEqual(
      expect.arrayContaining(['get', 'patch']),
    )
    expect(Object.keys(paths['/api/accounts/{accountId}/calendar'])).toEqual(
      expect.arrayContaining(['get', 'patch']),
    )
    expect(Object.keys(paths['/api/accounts/{accountId}/capacity'])).toEqual(
      expect.arrayContaining(['get', 'put']),
    )
    expect(Object.keys(paths['/api/accounts/{accountId}/absences'])).toEqual(
      expect.arrayContaining(['get', 'post']),
    )
    expect(Object.keys(paths['/api/accounts/{accountId}/absences/{absenceId}'])).toEqual(['delete'])
  })
})
