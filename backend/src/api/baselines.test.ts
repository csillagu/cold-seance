import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import type { Baseline } from '../service/baselines.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The baseline routes translate requests for the baseline service and nothing more (DD-039); the
// rules are tested against the database in test/integration/baselines.test.ts. Here the service is
// a stub, so these tests show what the routes hand it and what they send back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const V1 = '6f1c2a5e-0000-4000-8000-0000000000d1'
const SAVED_AT = new Date('2027-02-26T10:00:00.000Z')
const BASELINE: Baseline = {
  id: V1,
  projectId: APOLLO,
  name: 'v1 approved',
  savedAt: SAVED_AT,
  tasks: [
    {
      taskId: '6f1c2a5e-0000-4000-8000-0000000000b1',
      title: 'A',
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-03',
    },
    {
      taskId: '6f1c2a5e-0000-4000-8000-0000000000b2',
      title: 'Loose',
      plannedStart: null,
      plannedFinish: null,
    },
  ],
}
const SENT = { ...BASELINE, savedAt: SAVED_AT.toISOString() }

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
  const saveBaseline = vi.spyOn(services.baselines, 'saveBaseline')
  const listBaselines = vi.spyOn(services.baselines, 'listBaselines')
  const getBaseline = vi.spyOn(services.baselines, 'getBaseline')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, saveBaseline, listBaselines, getBaseline }
}

const projectUrl = `/api/projects/${APOLLO}/baselines`

describe('POST /api/projects/:projectId/baselines', () => {
  it('hands the service the caller, the project and the name, and answers 201', async () => {
    const { app, saveBaseline } = stubbed()
    saveBaseline.mockResolvedValue(BASELINE)
    const response = await app.inject({
      method: 'POST',
      url: projectUrl,
      headers: erin,
      payload: { name: 'v1 approved' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(SENT)
    expect(saveBaseline).toHaveBeenCalledWith(caller, APOLLO, { name: 'v1 approved' })
  })

  it('refuses a body without a name before the service is reached', async () => {
    const { app, saveBaseline } = stubbed()
    for (const payload of [{}, { title: 'v1' }]) {
      const response = await app.inject({ method: 'POST', url: projectUrl, headers: erin, payload })
      expect(response.statusCode).toBe(400)
    }
    expect(saveBaseline).not.toHaveBeenCalled()
  })

  it('refuses a project id that is not one before the service is reached', async () => {
    const { app, saveBaseline } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/apollo/baselines',
      headers: erin,
      payload: { name: 'v1' },
    })
    expect(response.statusCode).toBe(400)
    expect(saveBaseline).not.toHaveBeenCalled()
  })

  it("answers the service's refusals with their status and message", async () => {
    const { app, saveBaseline } = stubbed()
    const cases = [
      [new ServiceError('forbidden', 'no'), 403],
      [new ServiceError('conflict', 'taken'), 409],
      [new ServiceError('invalid', 'empty'), 400],
      [notVisible(), 403],
    ] as const
    for (const [error, status] of cases) {
      saveBaseline.mockRejectedValueOnce(error)
      const response = await app.inject({
        method: 'POST',
        url: projectUrl,
        headers: erin,
        payload: { name: 'v1' },
      })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ message: error.message })
    }
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, saveBaseline } = stubbed()
    const response = await app.inject({ method: 'POST', url: projectUrl, payload: { name: 'v1' } })
    expect(response.statusCode).toBe(401)
    expect(saveBaseline).not.toHaveBeenCalled()
  })
})

describe('GET /api/projects/:projectId/baselines', () => {
  it('hands the service the caller and the project, and sends back the baselines', async () => {
    const { app, listBaselines } = stubbed()
    const { tasks: _, ...summary } = BASELINE
    listBaselines.mockResolvedValue([summary])
    const response = await app.inject({ method: 'GET', url: projectUrl, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ ...summary, savedAt: SAVED_AT.toISOString() }])
    expect(listBaselines).toHaveBeenCalledWith(caller, APOLLO)
  })

  it('refuses a project id that is not one before the service is reached', async () => {
    const { app, listBaselines } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/baselines',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(listBaselines).not.toHaveBeenCalled()
  })
})

describe('GET /api/baselines/:baselineId', () => {
  it('hands the service the caller and the baseline, and sends it back with its dates', async () => {
    const { app, getBaseline } = stubbed()
    getBaseline.mockResolvedValue(BASELINE)
    const response = await app.inject({ method: 'GET', url: `/api/baselines/${V1}`, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SENT)
    expect(getBaseline).toHaveBeenCalledWith(caller, V1)
  })

  it('refuses a baseline id that is not one before the service is reached', async () => {
    const { app, getBaseline } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/baselines/v1', headers: erin })
    expect(response.statusCode).toBe(400)
    expect(getBaseline).not.toHaveBeenCalled()
  })

  it("answers the service's not-found as 404", async () => {
    const { app, getBaseline } = stubbed()
    getBaseline.mockRejectedValue(new ServiceError('not-found', 'There is no such baseline'))
    const response = await app.inject({ method: 'GET', url: `/api/baselines/${V1}`, headers: erin })
    expect(response.statusCode).toBe(404)
  })
})
