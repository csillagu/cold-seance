import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible } from '../service/errors.ts'
import type { RedFlag } from '../service/red-flags.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The red flags route translates requests for the red flag register and nothing more (DD-039);
// the rules are tested against the database in test/integration/red-flags.test.ts. Here the
// service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const CAROL = '6f1c2a5e-0000-4000-8000-000000000003'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const BOREALIS = '6f1c2a5e-0000-4000-8000-0000000000c2'
const T1 = '6f1c2a5e-0000-4000-8000-0000000000b1'
const M = '6f1c2a5e-0000-4000-8000-0000000000b2'
const RAISED = new Date('2026-11-05T10:00:00.000Z')

const FLAGS: RedFlag[] = [
  {
    id: '6f1c2a5e-0000-4000-8000-0000000000f1',
    projectId: APOLLO,
    kind: 'overload',
    key: `overload:${CAROL}:2027-03-01`,
    detail: { accountId: CAROL, date: '2027-03-01' },
    raisedAt: RAISED,
  },
  {
    id: '6f1c2a5e-0000-4000-8000-0000000000f2',
    projectId: APOLLO,
    kind: 'assignee-unavailable',
    key: `assignee-unavailable:${T1}`,
    detail: {
      task: { id: T1, projectId: APOLLO },
      overloads: [{ accountId: CAROL, date: '2027-03-01' }],
      holiday: false,
    },
    raisedAt: RAISED,
  },
  {
    id: '6f1c2a5e-0000-4000-8000-0000000000f3',
    projectId: APOLLO,
    kind: 'cross-project-dependency',
    key: `cross-project-dependency:${T1}:${M}`,
    detail: {
      task: { id: T1, projectId: APOLLO },
      blocker: { id: M, projectId: BOREALIS },
      crossProject: true,
      start: '2027-03-01',
      blockerFinish: '2027-03-05',
    },
    raisedAt: RAISED,
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
  const redFlagsOf = vi.spyOn(services.redFlags, 'redFlagsOf')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, redFlagsOf }
}

const url = `/api/projects/${APOLLO}/red-flags`

describe('GET /api/projects/:projectId/red-flags', () => {
  it('hands the service the caller and the project, and sends back each flag with its detail', async () => {
    const { app, redFlagsOf } = stubbed()
    redFlagsOf.mockResolvedValue(FLAGS)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      FLAGS.map(({ id, projectId, kind, detail }) => ({
        id,
        projectId,
        kind,
        raisedAt: '2026-11-05T10:00:00.000Z',
        ...detail,
      })),
    )
    expect(redFlagsOf).toHaveBeenCalledWith(caller, APOLLO)
  })

  it('refuses a project id that is not one before the service is reached', async () => {
    const { app, redFlagsOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/red-flags',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(redFlagsOf).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of a project the caller cannot see as not visible", async () => {
    const { app, redFlagsOf } = stubbed()
    redFlagsOf.mockRejectedValue(notVisible())
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(403)
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, redFlagsOf } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(redFlagsOf).not.toHaveBeenCalled()
  })
})
