import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The unassigned task rating route translates requests for the unassigned task load rating and
// nothing more (DD-039); the rules are tested against the database in
// test/integration/unassigned-ratings.test.ts. Here the service is a stub.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const BOB = '6f1c2a5e-0000-4000-8000-000000000006'
const TASK = '6f1c2a5e-0000-4000-8000-0000000000b1'
const PROJECT = '6f1c2a5e-0000-4000-8000-0000000000c1'
const RATINGS = [
  {
    taskId: TASK,
    title: 'U',
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-05',
    eligibility: { all: [ERIN, { any: [BOB, ERIN] }] },
    rating: 'amber' as const,
  },
]

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin' ? { accountId: ERIN, channel: 'ui' } : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'ui' }
const url = `/api/projects/${PROJECT}/unassigned-task-ratings`

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const ratingsOf = vi.spyOn(services.unassignedRatings, 'ratingsOf')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, ratingsOf }
}

describe('GET /api/projects/:projectId/unassigned-task-ratings', () => {
  it('hands the service the caller and the project, and sends back the ratings', async () => {
    const { app, ratingsOf } = stubbed()
    ratingsOf.mockResolvedValue(RATINGS)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RATINGS)
    expect(ratingsOf).toHaveBeenCalledWith(caller, PROJECT)
  })

  it('refuses a project id that is not one', async () => {
    const { app, ratingsOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/unassigned-task-ratings',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(ratingsOf).not.toHaveBeenCalled()
  })

  it("answers the service's refusals in the API's shape", async () => {
    const { app, ratingsOf } = stubbed()
    ratingsOf.mockRejectedValue(new ServiceError('not-found', 'There is no such project'))
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ message: 'There is no such project' })
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, ratingsOf } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(ratingsOf).not.toHaveBeenCalled()
  })
})
