import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { ProposalConflicts } from '../service/proposal-conflicts.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The proposal conflicts route translates requests for the proposal conflict detector and nothing
// more (DD-039); the rules are tested against the database in
// test/integration/proposal-conflicts.test.ts. Here the service is a stub, so these tests show
// what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const A = '6f1c2a5e-0000-4000-8000-0000000000b1'
const P1 = '6f1c2a5e-0000-4000-8000-0000000000e1'
const G1 = '6f1c2a5e-0000-4000-8000-0000000000f1'
const C1 = '6f1c2a5e-0000-4000-8000-0000000000d1'
const C2 = '6f1c2a5e-0000-4000-8000-0000000000d2'

const CONFLICTS: ProposalConflicts = {
  proposalId: P1,
  conflicts: [
    { groupId: G1, changeId: C1, taskId: A, reason: 'edited', inputs: ['plannedStart'] },
    { groupId: G1, changeId: C2, taskId: A, reason: 'deleted', inputs: [] },
  ],
}

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin'
    ? { accountId: ERIN, channel: 'rest-api' }
    : undefined
const erin = { authorization: 'Bearer erin' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const conflictsOf = vi.spyOn(services.proposalConflicts, 'conflictsOf')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, conflictsOf }
}

describe('GET /api/proposals/:proposalId/conflicts', () => {
  it("sends the proposal's conflicts as the detector gives them", async () => {
    const { app, conflictsOf } = stubbed()
    conflictsOf.mockResolvedValue(CONFLICTS)
    const response = await app.inject({
      method: 'GET',
      url: `/api/proposals/${P1}/conflicts`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CONFLICTS)
    expect(conflictsOf).toHaveBeenCalledWith({ accountId: ERIN, channel: 'rest-api' }, P1)
  })

  it("answers the detector's refusal", async () => {
    const { app, conflictsOf } = stubbed()
    conflictsOf.mockRejectedValue(new ServiceError('not-found', 'There is no such proposal'))
    const response = await app.inject({
      method: 'GET',
      url: `/api/proposals/${P1}/conflicts`,
      headers: erin,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ message: string }>().message).toBe('There is no such proposal')
  })

  it('refuses an id that is not a uuid before the detector is reached', async () => {
    const { app, conflictsOf } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/proposals/nope/conflicts',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(conflictsOf).not.toHaveBeenCalled()
  })
})
