import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { BaselineVariance } from '../service/variance.ts'
import type { Authenticator } from './caller.ts'

// The variance route translates requests for the variance calculator and nothing more (DD-039);
// the rules are tested against the database in test/integration/variance.test.ts. Here the
// service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const V1 = '6f1c2a5e-0000-4000-8000-0000000000d1'
const SAVED_AT = new Date('2027-02-26T10:00:00.000Z')
const VARIANCE: BaselineVariance = {
  baseline: { id: V1, projectId: APOLLO, name: 'v1', savedAt: SAVED_AT },
  tasks: [
    {
      taskId: '6f1c2a5e-0000-4000-8000-0000000000b1',
      title: 'T',
      milestone: false,
      baseline: { start: '2027-03-01', finish: '2027-03-03' },
      planned: { start: '2027-03-02', finish: '2027-03-04' },
      actual: { start: null, finish: null },
      variance: { start: 1, finish: 1 },
    },
    {
      taskId: '6f1c2a5e-0000-4000-8000-0000000000b2',
      title: 'Later',
      milestone: false,
      baseline: null,
      planned: { start: null, finish: null },
      actual: { start: null, finish: null },
      variance: { start: null, finish: null },
    },
  ],
}
const SENT = { ...VARIANCE, baseline: { ...VARIANCE.baseline, savedAt: SAVED_AT.toISOString() } }

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
  const varianceAgainst = vi.spyOn(services.variance, 'varianceAgainst')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, varianceAgainst }
}

const url = `/api/baselines/${V1}/variance`

describe('GET /api/baselines/:baselineId/variance', () => {
  it('hands the service the caller and the baseline, and sends what it computes', async () => {
    const { app, varianceAgainst } = stubbed()
    varianceAgainst.mockResolvedValue(VARIANCE)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SENT)
    expect(varianceAgainst).toHaveBeenCalledWith(caller, V1)
  })

  it("answers the service's refusals with their statuses", async () => {
    const { app, varianceAgainst } = stubbed()
    const cases = [
      [new ServiceError('not-found', 'There is no such baseline'), 404],
      [notVisible(), 403],
    ] as const
    for (const [error, status] of cases) {
      varianceAgainst.mockRejectedValueOnce(error)
      const response = await app.inject({ method: 'GET', url, headers: erin })
      expect(response.statusCode).toBe(status)
    }
  })

  it('refuses an id that is not a uuid before the service is called', async () => {
    const { app, varianceAgainst } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/baselines/v1/variance',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(varianceAgainst).not.toHaveBeenCalled()
  })

  it('refuses a caller no authenticator recognises', async () => {
    const { app, varianceAgainst } = stubbed()
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(401)
    expect(varianceAgainst).not.toHaveBeenCalled()
  })
})
