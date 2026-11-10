import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { Proposal } from '../service/proposals.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The proposal routes translate requests for the proposal store and nothing more (DD-039); the
// rules are tested against the database in test/integration/proposals.test.ts. Here the service is
// a stub, so these tests show what the routes hand it and what they send back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const A = '6f1c2a5e-0000-4000-8000-0000000000b1'
const P1 = '6f1c2a5e-0000-4000-8000-0000000000e1'
const G1 = '6f1c2a5e-0000-4000-8000-0000000000f1'
const C1 = '6f1c2a5e-0000-4000-8000-0000000000f2'
const C2 = '6f1c2a5e-0000-4000-8000-0000000000f3'
const AT = new Date('2027-02-26T10:00:00.000Z')
const PROPOSAL: Proposal = {
  id: P1,
  createdBy: ERIN,
  channel: 'rest-api',
  createdAt: AT,
  lastEditedAt: AT,
  status: 'waiting',
  rejectedAt: null,
  rejectedBy: null,
  appliedAt: null,
  approvals: [],
  projectIds: [APOLLO],
  groups: [
    {
      id: G1,
      changes: [
        {
          id: C1,
          kind: 'create-task',
          key: 'new',
          projectId: APOLLO,
          fields: { title: 'New', durationWorkingDays: 2 },
        },
        {
          id: C2,
          kind: 'add-blocker',
          projectId: APOLLO,
          task: { newTask: 'new' },
          blocker: { taskId: A },
        },
      ],
    },
  ],
}
const SENT = { ...PROPOSAL, createdAt: AT.toISOString(), lastEditedAt: AT.toISOString() }

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin'
    ? { accountId: ERIN, channel: 'rest-api' }
    : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'rest-api' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const createProposal = vi.spyOn(services.proposals, 'createProposal')
  const getProposal = vi.spyOn(services.proposals, 'getProposal')
  const listProposals = vi.spyOn(services.proposals, 'listProposals')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, createProposal, getProposal, listProposals }
}

describe('POST /api/proposals', () => {
  it('hands the groups to the proposal store as they were sent and answers 201', async () => {
    const { app, createProposal } = stubbed()
    createProposal.mockResolvedValue(PROPOSAL)
    const groups = [{ changes: [{ kind: 'cancel-task', task: { taskId: A }, extra: 1 }] }]
    const response = await app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: erin,
      payload: { groups },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(SENT)
    // Nothing inside the groups is coerced or dropped: the store decides what a change is.
    expect(createProposal).toHaveBeenCalledWith(caller, { groups })
  })

  it("answers the store's refusal", async () => {
    const { app, createProposal } = stubbed()
    createProposal.mockRejectedValue(new ServiceError('forbidden', 'Not through the UI'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: erin,
      payload: { groups: [] },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json<{ message: string }>().message).toBe('Not through the UI')
  })

  it('refuses a body without the groups before the store is reached', async () => {
    const { app, createProposal } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: erin,
      payload: { changes: [] },
    })
    expect(response.statusCode).toBe(400)
    expect(createProposal).not.toHaveBeenCalled()
  })
})

describe('GET /api/proposals/:proposalId and /api/projects/:projectId/proposals', () => {
  it('reads one proposal', async () => {
    const { app, getProposal } = stubbed()
    getProposal.mockResolvedValue(PROPOSAL)
    const response = await app.inject({ method: 'GET', url: `/api/proposals/${P1}`, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SENT)
    expect(getProposal).toHaveBeenCalledWith(caller, P1)
  })

  it("lists a project's proposals", async () => {
    const { app, listProposals } = stubbed()
    listProposals.mockResolvedValue([PROPOSAL])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${APOLLO}/proposals`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([SENT])
    expect(listProposals).toHaveBeenCalledWith(caller, APOLLO)
  })
})
