import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Violation } from '../service/violations.ts'
import type { Authenticator } from './caller.ts'

// The violations route translates requests for the violation detector and nothing more (DD-039);
// the rules are tested against the database in test/integration/violations.test.ts. Here the
// service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const BOREALIS = '6f1c2a5e-0000-4000-8000-0000000000c2'
const VIOLATIONS: Violation[] = [
  {
    kind: 'cross-project-dependency',
    task: { id: '6f1c2a5e-0000-4000-8000-0000000000b1', projectId: APOLLO, title: 'T' },
    blocker: { id: '6f1c2a5e-0000-4000-8000-0000000000b2', projectId: BOREALIS, title: 'M' },
    crossProject: true,
    start: '2027-03-11',
    blockerFinish: '2027-03-17',
  },
  {
    kind: 'fixed-date-milestone-pushed',
    task: { id: '6f1c2a5e-0000-4000-8000-0000000000b3', projectId: APOLLO, title: 'Launch' },
    blocker: { id: '6f1c2a5e-0000-4000-8000-0000000000b4', projectId: APOLLO, title: 'A' },
    crossProject: false,
    start: '2027-03-12',
    blockerFinish: '2027-03-19',
  },
]

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
  const violationsOf = vi.spyOn(services.violations, 'violationsOf')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, violationsOf }
}

const url = `/api/projects/${APOLLO}/violations`

describe('GET /api/projects/:projectId/violations', () => {
  it('hands the service the caller and the project, and sends back the violations', async () => {
    const { app, violationsOf } = stubbed()
    violationsOf.mockResolvedValue(VIOLATIONS)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(VIOLATIONS)
    expect(violationsOf).toHaveBeenCalledWith(caller, APOLLO)
  })

  it('refuses a project id that is not one before the service is reached', async () => {
    const { app, violationsOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/violations',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(violationsOf).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of a project the caller cannot see as not visible", async () => {
    const { app, violationsOf } = stubbed()
    violationsOf.mockRejectedValue(notVisible())
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ message: 'This project is not visible to you' })
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, violationsOf } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(violationsOf).not.toHaveBeenCalled()
  })
})
