import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The person load route translates requests for the daily person load aggregator and nothing more
// (DD-039); the rules are tested against the database in test/integration/daily-person-load.test.ts.
// Here the service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const TASK = '6f1c2a5e-0000-4000-8000-0000000000b1'
const PROJECT = '6f1c2a5e-0000-4000-8000-0000000000c1'
const LOAD = {
  accountId: ERIN,
  from: '2027-03-01',
  to: '2027-03-02',
  days: [
    {
      date: '2027-03-01',
      load: 100,
      tasks: [{ taskId: TASK, projectId: PROJECT, title: 'T', load: 40 }],
      otherProjects: 60,
      capacity: 100,
      overloaded: false,
    },
    {
      date: '2027-03-02',
      load: 0,
      tasks: [],
      otherProjects: 0,
      capacity: null,
      overloaded: null,
    },
  ],
}

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
  const loadOf = vi.spyOn(services.dailyLoad, 'loadOf')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, loadOf }
}

const url = `/api/accounts/${ERIN}/load?from=2027-03-01&to=2027-03-02`

describe('GET /api/accounts/:accountId/load', () => {
  it('hands the service the caller, the person and the span, and sends back the load', async () => {
    const { app, loadOf } = stubbed()
    loadOf.mockResolvedValue(LOAD)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(LOAD)
    expect(loadOf).toHaveBeenCalledWith(caller, ERIN, { from: '2027-03-01', to: '2027-03-02' })
  })

  it('refuses a request without both days before the service is reached', async () => {
    const { app, loadOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN}/load?from=2027-03-01`,
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(loadOf).not.toHaveBeenCalled()
  })

  it('hands the service no query field but the two days', async () => {
    const { app, loadOf } = stubbed()
    loadOf.mockResolvedValue(LOAD)
    const response = await app.inject({ method: 'GET', url: `${url}&person=x`, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(loadOf).toHaveBeenCalledWith(caller, ERIN, { from: '2027-03-01', to: '2027-03-02' })
  })

  it('refuses an account id that is not one', async () => {
    const { app, loadOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts/erin/load?from=2027-03-01&to=2027-03-02',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(loadOf).not.toHaveBeenCalled()
  })

  it("answers the service's refusals in the API's shape", async () => {
    const { app, loadOf } = stubbed()
    loadOf.mockRejectedValue(new ServiceError('invalid', 'The last day cannot be before the first'))
    const invalid = await app.inject({ method: 'GET', url, headers: erin })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ message: 'The last day cannot be before the first' })

    loadOf.mockRejectedValue(new ServiceError('not-found', 'There is no such account'))
    expect((await app.inject({ method: 'GET', url, headers: erin })).statusCode).toBe(404)
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, loadOf } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(loadOf).not.toHaveBeenCalled()
  })
})
